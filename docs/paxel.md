# Paxel: AI coding habits profiler

Paxel is the Zinloop module that measures how your developers use AI
coding tools. It answers three questions:

- **How many LLM tokens did we burn this month, and what did it cost?**
- **Which tool did it (Claude Code, Codex, Cursor, Copilot, Aider)?**
- **Which developer, on which project?**

Each developer gets a personal view. Each company gets an aggregated view.

## What Paxel reads

Paxel reads each AI coding tool's **local session logs** on the laptop:

| Tool          | Source read                                    |
| ------------- | ---------------------------------------------- |
| Claude Code   | `~/.claude/projects/*/*.jsonl`                 |
| OpenAI Codex  | `~/.codex/sessions/**/*.jsonl`                 |

It aggregates per-day buckets by (tool, user, project, model, session)
and uploads only numbers and labels:

- tool name (`claude-code`, `codex`, …)
- model name (`claude-sonnet-4-5-20250929`, `gpt-5-codex`, …)
- a hash of the OS user name plus hostname (so the same person on the
  same laptop merges — never the real user name)
- a hash of the project path, plus the project folder's basename
- token counts (input, output, cache read, cache write)
- an estimated USD cost in cents (using a built-in price table)
- a session id and a UTC day

Prompts, generated code, and absolute file paths never leave the laptop.

## Running it

```
# Human-readable summary of this laptop
zinloop paxel

# JSON of the upload Paxel would send
zinloop paxel --json

# Upload to a Zinloop console
export ZINLOOP_TOKEN=zlu_...
zinloop paxel --upload https://console.example/api/paxel/usage
```

The upload endpoint accepts the same `zlu_` tokens as `POST /api/scans`,
so you can run both from one install.

## Dashboards

- `/app/paxel` — MSP company-wide view: totals, by tool, by developer, by
  project. Links through to each developer.
- `/app/paxel/dev/{user_hash}` — one developer's usage from the MSP side.
- `/portal/paxel` — client-portal view, scoped by RLS to one client.
- `/portal/paxel/dev/{user_hash}` — one developer, from the client's view.

Each dashboard supports 7-, 30- and 90-day ranges.

## Why inside Zinloop (not a separate app)

Paxel reuses the Zinloop account model, upload tokens, device table, and
tenant isolation (per-MSP RLS, per-client viewer policies). An MSP that
cares about agent/MCP security also cares about who is spending how many
tokens on which project — one pane makes the sale, and one login keeps
the ops surface small.

## Not yet in Paxel

- Cursor and GitHub Copilot don't expose per-request token counts in
  local logs. "Was active in this project" presence detection is a
  follow-up PR.
- Aider's chat history has no built-in usage field. If the user runs it
  with `aider --analytics-log`, Paxel can read that log — follow-up.
- Linking a logged-in user to their `user_hash` for a true "my view" in
  the portal. Today the portal shows the client's whole team.
