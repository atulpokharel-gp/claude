# agentscan

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
| `UNPINNED_PACKAGE` | medium | `npx`/`uvx`/`dlx` packages with no fixed version, or `@latest` |
| `KEY_NOT_ROTATED` | medium | A key moved by `fix-secrets` that was exposed before and hasn't been replaced yet |
| `REMOTE_SERVER` | low | Data sent to an outside service |
| `SHELL_LAUNCHER` | low | Server started through `bash -c` or similar |

## Use

```sh
go build -o agentscan ./cmd/agentscan
./agentscan                       # readable summary
./agentscan --json                # JSON to stdout
./agentscan --out scan.json       # also save JSON (file mode 0600)
./agentscan --fail-on high        # exit code 2 if anything is high risk
```

## Fix plain-text keys

`fix-secrets` moves keys out of AI configs and into the computer's own
password store (macOS Keychain, Windows Credential Manager, or the Linux
Secret Service). The AI app keeps working because the server now starts
through `agentscan exec`, which reads the key from the store and passes it to
the server at start-up.

```sh
./agentscan fix-secrets            # preview only, changes nothing
./agentscan fix-secrets --apply    # make the change (close the AI apps first)
./agentscan rotate --list          # keys that were exposed and still need replacing
./agentscan rotate <name>          # paste a new key from the provider
```

What `--apply` does, per config file:

1. Saves each key to the password store and reads it back to check it.
2. Copies the original file to `<file>.agentguard-backup-<time>` (owner-only).
3. Rewrites the server entry, for example
   `"command": "npx", "env": {"GITHUB_TOKEN": "ghp_..."}` becomes
   `"command": "/path/to/agentscan", "args": ["exec", "--secret", "GITHUB_TOKEN=claude-desktop/github/GITHUB_TOKEN@3aa8de04", "--", "npx", ...]`.
4. Records the move in `~/.agentguard/secrets.json` (names and dates only).

If any step fails, that file is left exactly as it was. Keys in headers,
command-line arguments or URLs, and servers in VS Code's `settings.json`, are
listed for fixing by hand. Run agentscan from a permanent location, since its
path is written into the configs. Rewritten files keep every setting, though
key order may change.

## Privacy

- Scanning only reads config files and makes no network calls. Only
  `fix-secrets --apply` and `rotate` change anything.
- Env and header **values** are kept in memory for the checks but never written
  out; the report lists only their names.
- Arguments that look like tokens and the user/query parts of URLs are replaced
  with `[REDACTED]`.

## Layout

```
cmd/agentscan      command-line entry point
internal/discover  config locations per OS and parsing (handles JSON with comments)
internal/rules     risk checks
internal/report    report building, redaction, text output
testdata/          fake configs used by tests (no real credentials)
```
