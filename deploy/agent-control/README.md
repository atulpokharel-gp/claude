# Agent Control server (upstream, run alongside Zinloop)

This directory runs the open-source [Agent Control](https://github.com/agentcontrol/agent-control)
server next to the Zinloop stack. It is the real project, pulled as its published
Docker Hub images (`galileoai/agent-control-server`, Postgres). We deliberately do
**not** fork or copy its Python source into this repo: running it upstream means
security fixes arrive with a `docker compose pull`, and there's no divergent fork
to maintain.

## What you get

- **Agent Control server + dashboard** at `http://localhost:8000` (configurable).
- Its own **Postgres** on host port `15432` by default, with a dedicated volume
  (`agent_control_pgdata`) that is separate from the Zinloop database.
- Centralized runtime controls, pluggable evaluators (regex / list / JSON / SQL
  plus bring-your-own), framework adapters (LangChain, CrewAI, Google ADK, AWS
  Strands) and observability sinks — all from upstream, unchanged.

## How this relates to Zinloop's own Agent Control Plane

Zinloop already ships a native control plane built on our Next.js/TypeScript +
Postgres stack: migration `console/db/migrations/020_agent_control_plane.sql`, the
`/app/agents` console page, and the TypeScript SDK in `sdk/typescript/`. It covers
the same core ideas (evaluators, input/output/tool phases, block/warn, enrollment
tokens, an OpenTelemetry callback) and adds per-agent **budgets** and a **task
channel** that upstream doesn't have.

These are **two independent control planes**. This directory stands the upstream
one up so you can use its Python SDK and framework adapters directly. What is
**not** built yet, and should not be assumed working:

- No automatic sharing of agents, controls, or events between the upstream server
  and the Zinloop console. They have separate databases and separate dashboards.
- No single-pane-of-glass view in the Zinloop console of upstream-server activity.

A follow-up could forward upstream control events into the Zinloop console via a
custom observability sink (upstream supports `register_control_event_sink`). That
integration is a separate piece of work, not part of standing up the server.

## Run it

```bash
cd deploy/agent-control
cp .env.example .env          # then fill in every CHANGE_ME
docker compose up -d
curl http://localhost:8000/health
```

Open `http://localhost:8000` for the dashboard. Point an agent at it with the
upstream SDK:

```bash
uv pip install agent-control-sdk
export AGENT_CONTROL_URL=http://localhost:8000
export AGENT_CONTROL_API_KEY=<one of AGENT_CONTROL_API_KEYS>
```

Stop it with `docker compose down` (add `-v` to also wipe its database volume).

## Security must-dos

- **Keep API keys enabled.** `.env.example` ships with `AGENT_CONTROL_API_KEY_ENABLED=true`
  and required keys. With keys off, the server trusts any caller — fine only for a
  throwaway local demo, never for anything reachable.
- The dashboard/API are **not** behind Zinloop's Caddy or auth. If you expose this
  beyond localhost, put it behind your own TLS + auth and set
  `AGENT_CONTROL_CORS_ORIGINS` to the real origin.
- The upstream runtime **sees agent inputs/outputs in transit** for evaluation,
  same caveat as Zinloop's online runtime (see `sdk/typescript/README.md`). This is
  different from the offline laptop scanner, which keeps content local.

## Attribution

Agent Control is licensed under **Apache License 2.0**, Copyright its authors. This
directory redistributes only configuration that references their published images;
it contains none of their source. See the upstream `LICENSE` and `NOTICE` at
https://github.com/agentcontrol/agent-control for the full terms.
