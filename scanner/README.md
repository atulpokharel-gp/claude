# zinloop

Finds AI agent (MCP server) configurations on a computer and reports risky
settings. One file, no install, runs on Windows, macOS and Linux, so an MSP can
push it through their remote-management tool.

## What it checks

**Where it looks**

| App | File |
| --- | --- |
| Claude Desktop | `claude_desktop_config.json` in the app's config folder |
| Claude Code | `~/.claude.json` (global and per-project servers), project `.mcp.json` |
| Cursor | `~/.cursor/mcp.json`, project `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code | user `mcp.json` and `settings.json`, project `.vscode/mcp.json` |

Pass `--project <folder>` (repeatable) to also check project folders.

**Risk rules**

| Rule | Severity | Flags |
| --- | --- | --- |
| `SECRET_IN_CONFIG` | high | Keys or tokens written in plain text in env, headers, args or the URL |
| `SHELL_ACCESS` | high | Servers that give the AI a terminal |
| `BROAD_FILESYSTEM` | high | Filesystem servers allowed into `/`, the home folder or a whole drive |
| `INSECURE_TRANSPORT` | high | Remote servers over plain `http` |
| `RISKY_CONTAINER` | high | Docker with `--privileged`, host networking, or the Docker socket mounted |
| `HIDDEN_INSTRUCTIONS` | high | Zero-width or bidi-override characters, or prompt-injection phrases, hiding in a server's config values (config-level tool poisoning) |
| `UNTRUSTED_SOURCE` | high | `npx`/`uvx` installing from a git URL, direct URL or local path (bypasses registry provenance) |
| `UNPINNED_PACKAGE` | medium | `npx`/`uvx`/`dlx` packages with no fixed version, or `@latest` |
| `UNTRUSTED_REGISTRY` | medium | `--registry` / `--index-url` pointing somewhere other than npm or PyPI |
| `OAUTH_BROAD_SCOPE` | medium | Admin-level or write-all OAuth scopes (`admin:*`, `write:all`, `offline_access`, …) in scope-related env, args or URL params |
| `KEY_NOT_ROTATED` | medium | A key moved by `fix-secrets` that was exposed before and hasn't been replaced yet |
| `REMOTE_SERVER` | low | Data sent to an outside service |
| `SHELL_LAUNCHER` | low | Server started through `bash -c` or similar |

**Skill rules**

Alongside MCP configs, the scanner walks Claude Code "skill" directories
(`~/.claude/skills/`, `~/.claude/plugins/<plugin>/skills/`, and project
`<project>/.claude/skills/`) and reads each `SKILL.md`. Findings appear in
the `skills` section of the report.

| Rule | Severity | Flags |
| --- | --- | --- |
| `SKILL_HIDDEN_INSTRUCTIONS` | high | Zero-width or bidi-override characters, or prompt-injection phrases, in a skill's name, description or body |
| `SKILL_BROAD_TOOL_ACCESS` | medium | A skill grants itself shell-equivalent tools (`Bash`, `Bash(*)`, `Bash(sudo…)`, `Write`, `Edit`, `*`, …) |

**Runtime tool-poisoning rule**

Pass `--probe-tools` to start each stdio MCP server, speak the MCP
`initialize` + `tools/list` handshake, and check every tool it returns
for hidden characters or prompt-injection phrases that configuration
alone cannot see. The rule is off by default because, unlike the rest
of the scan, it executes the configured servers; servers started
through `bash -c "..."` wrappers are refused outright. Pair with
`--probe-timeout <duration>` to tune the per-server timeout
(default `5s`).

| Rule | Severity | Flags |
| --- | --- | --- |
| `TOOL_POISONING` | high | A live tool's name or description carries zero-width/bidi characters or an injection phrase (`ignore previous`, `<system>`, …) that an agent reads on every call |

## Use

```sh
go build -o zinloop ./cmd/zinloop
./zinloop                       # readable summary
./zinloop --json                # JSON to stdout
./zinloop --out scan.json       # also save JSON (file mode 0600)
./zinloop --fail-on high        # exit code 2 if anything is high risk
./zinloop --all-users           # every user profile (run as administrator/root)
./zinloop --probe-tools         # also start each stdio MCP server and scan its live tool list
```

RMM tools run scripts as SYSTEM or root, whose own home has no AI configs, so
use `--all-users` there. [`rmm/`](rmm/) has ready-made install scripts for
Windows (PowerShell) and macOS/Linux that download the scanner from your
console, check its SHA-256, store the upload token where only administrators
can read it, run the scan, and schedule it to run every day.

A daily scheduled scan is set up by default:

| OS | Mechanism | Window |
| --- | --- | --- |
| Windows | Scheduled task running as SYSTEM | 10:00 local, random delay up to 2h |
| macOS | launchd daemon in `/Library/LaunchDaemons/` | 10:00 local, random delay up to 2h |
| Linux (systemd) | `zinloop-scan.timer` with `RandomizedDelaySec=2h` | 10:00 local, random delay up to 2h |
| Linux (other) | cron file in `/etc/cron.d/zinloop` | 10:xx local, random delay up to 2h |

Set `ZINLOOP_NO_SCHEDULE=1` (Unix) or pass `-NoSchedule` (Windows) to skip
scheduling, for example if the RMM tool runs the scan itself on a schedule.

## Fix plain-text keys

`fix-secrets` moves keys out of AI configs and into the computer's own
password store (macOS Keychain, Windows Credential Manager, or the Linux
Secret Service). The AI app keeps working because the server now starts
through `zinloop exec`, which reads the key from the store and passes it to
the server at start-up.

```sh
./zinloop fix-secrets            # preview only, changes nothing
./zinloop fix-secrets --apply    # make the change (close the AI apps first)
./zinloop rotate --list          # keys that were exposed and still need replacing
./zinloop rotate <name>          # paste a new key from the provider
```

What `--apply` does, per config file:

1. Saves each key to the password store and reads it back to check it.
2. Copies the original file to `<file>.zinloop-backup-<time>` (owner-only).
3. Rewrites the server entry, for example
   `"command": "npx", "env": {"GITHUB_TOKEN": "ghp_..."}` becomes
   `"command": "/path/to/zinloop", "args": ["exec", "--secret", "GITHUB_TOKEN=claude-desktop/github/GITHUB_TOKEN@3aa8de04", "--", "npx", ...]`.
4. Records the move in `~/.zinloop/secrets.json` (names and dates only).

If any step fails, that file is left exactly as it was. Keys in headers,
command-line arguments or URLs, and servers in VS Code's `settings.json`, are
listed for fixing by hand. Run zinloop from a permanent location, since its
path is written into the configs. Rewritten files keep every setting, though
key order may change.

## Install as a long-running service

For a laptop that should keep itself scanned without an RMM, install the
scanner as a system service. The service scans on an interval (24h with up to
2h of jitter by default), uploads to the console, and restarts itself if it
crashes.

```sh
sudo zinloop install --url https://zinloop.com --token zlu_...
zinloop status                 # last scan, OS service state
zinloop logs --follow          # journal / launchd log / schtasks log
sudo zinloop uninstall --purge # remove service + config + token
```

| OS | What `install` sets up | Status / logs come from |
| --- | --- | --- |
| Linux (systemd) | `/etc/systemd/system/zinloop.service` running `zinloop service run` as root, `Restart=on-failure` | `systemctl status zinloop` / `journalctl -u zinloop` |
| macOS | `/Library/LaunchDaemons/com.zinloop.service.plist` with `KeepAlive=true` | `launchctl print system/com.zinloop.service` / `/etc/zinloop/zinloop.log` |
| Windows | Scheduled Task `Zinloop` running as SYSTEM at boot (`schtasks /SC ONSTART`) | `schtasks /Query /TN Zinloop /V` / `%ProgramData%\Zinloop\zinloop.log` |

Install removes the old oneshot daily-scan units from the RMM installer
(`zinloop-scan.timer`, `com.zinloop.scan`, `ZinloopDailyScan`, cron entry) so
the service doesn't double-scan with them.

Config lives at `/etc/zinloop/config.json` (or `%ProgramData%\Zinloop\config.json`
on Windows). The upload token is stored next to it at mode 0600. State the
daemon writes between runs — last scan, counters, last error — lands in
`state.json` beside the config, which is what `zinloop status` reads.

Flags:

| Flag | Default | What it does |
| --- | --- | --- |
| `--url` | *required* | Console URL, e.g. `https://zinloop.com` |
| `--token` / `--token-file` | *required* | Upload token or a file holding it (prefer the file; args can leak via `/proc`) |
| `--interval-hours` | `24` | Hours between scans |
| `--jitter-seconds` | `7200` | Random extra delay added to each scan |
| `--all-users` | `true` | Scan every user profile (needs root/Administrator) |
| `--no-start` | — | Install but don't start; let the next reboot pick it up |
| `--force` | — | Overwrite an existing install |

## Send scans to the console

```sh
ZINLOOP_TOKEN=zlu_... zinloop --upload https://your-console/api/scans
zinloop --upload https://your-console/api/scans --token-file C:\ProgramData\zinloop\token
```

The upload token comes from the client's page in the console. It's read from
the environment or a file, never a command-line flag, so it doesn't show in the
process list. Uploads need https (plain http only to `localhost`). Exit code 3
means the scan ran but the upload failed.

## Privacy

- Scanning only reads config files and makes no network calls unless you pass
  `--upload`. Only `fix-secrets --apply` and `rotate` change anything.
- Env and header **values** are kept in memory for the checks but never written
  out; the report lists only their names.
- Arguments that look like tokens and the user/query parts of URLs are replaced
  with `[REDACTED]`.

## Layout

```
cmd/zinloop      command-line entry point
internal/discover  config locations per OS and parsing (handles JSON with comments)
internal/rules     risk checks
internal/report    report building, redaction, text output
testdata/          fake configs used by tests (no real credentials)
```
