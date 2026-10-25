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
- `/app/paxel/dev/{user_hash}` — one developer's usage and builder-profile
  scores from the MSP side.
- `/app/paxel/team` — anonymous team-wide builder profile. Averages only,
  no names, requires 3+ developers to render.
- `/portal/paxel` — client-portal view, scoped by RLS to one client.
- `/portal/paxel/dev/{user_hash}` — one developer, from the client's view.
  Also carries the "share a public profile" form.
- `/paxel/settings` — the developer's self-serve home. Shows the private
  profile, lets the dev turn public sharing on or off, pick which
  dimensions to publish, change the display name, see the public URL,
  and sign out of this browser's claim. No MSP or portal login is
  required — only the `paxel_dev` cookie set by `/paxel/claim`.
- `/p/{slug}` — unauthenticated public profile. Shows only the dimensions
  the developer opts into. Off by default.
- `/leaderboard` — unauthenticated, cross-tenant leaderboard. Lists only
  developers who turned a public profile on; everyone else stays hidden.
  Ranked by mean of the ticked dimensions, or filter to a single
  dimension.
- `/app/paxel/leaderboard` — MSP company leaderboard. Every developer the
  MSP sees, ranked. No opt-in required (internal view).
- `/portal/paxel/leaderboard` — client-portal team leaderboard. Every
  developer in the signed-in viewer's one client, ranked.

Each dashboard supports 7-, 30- and 90-day ranges.

## Builder profile (five dimensions)

Each Claude Code session is scored on the laptop on five dimensions:

| Dimension | Signal |
| --- | --- |
| Steering | user-turn specificity, correction density, prompt-to-tool ratio |
| Execution | tool-use density, writes over reads, session length |
| Engineering | tests edited, lint/typecheck/test Bash runs, refactor-shape edits |
| Product instinct | docs / UI / API edits over internals-only work |
| Planning | long first user turn, TODO/outline shapes, `TodoWrite` use |

Scores are integers 0–100. Only the final scores and small integer
metric counters leave the laptop; prompts and code never upload.

Three views sit on top of these:

- **Private** — the signed-in console or portal page for one developer.
- **Public** — unauthenticated `/p/{slug}`. Off by default; the dev picks
  a slug and toggles which dimensions appear.
- **Company** — anonymous team aggregates on `/app/paxel/team`. No
  individual rows, no names.

## Developer identity claim

Only the developer whose laptop reports a `user_hash` can edit the public
profile prefs for that `user_hash`. Flow:

1. First `zinloop paxel` run writes `~/.zinloop/paxel-claim-token` (0600,
   32 random bytes, base64url).
2. Each run uploads `{ userHash, claimToken }` under `claim:` in the
   JSON. The console stores only the SHA-256 of the token in
   `paxel_user_claims`.
3. The CLI prints a one-time URL in the shape
   `https://zinloop.com/paxel/claim?token=…`. Opening it in a browser
   sets a signed `paxel_dev` cookie bound to that user_hash.
4. The dev manages their profile at `/paxel/settings`, which is gated
   only by that cookie. The share form on `/portal/paxel/dev/{user}` is
   also shown when the cookie matches the page's `user_hash`; other
   viewers see the current URL read-only.
5. To rebind another browser or regenerate the token, run
   `zinloop paxel` on the laptop; delete
   `~/.zinloop/paxel-claim-token` first to issue a brand new token
   (invalidates every browser signed in with the old one).

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
