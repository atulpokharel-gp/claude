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

## Privacy

- Reads config files only. Never changes them and makes no network calls.
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
