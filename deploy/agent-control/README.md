# Agent Control server (upstream, part of the main stack)

The open-source [Agent Control](https://github.com/agentcontrol/agent-control)
server (Apache-2.0) runs as two services in the root `docker-compose.yml`:

- `agent-control` — the server + dashboard, pulled from its published Docker Hub
  image `galileoai/agent-control-server` (not forked or vendored).
- `agent-control-db` — its **own** Postgres with a dedicated volume
  (`agent_control_pgdata`), separate from the tenant `db` so none of its tables
  touch Zinloop's RLS-protected data.

It comes up with everything else on `docker compose up -d`, and the production
deploy pulls and starts it like the other services.

## Config

All settings live in the **root** `.env` (see `.env.example`), not here:

- `AGENT_CONTROL_POSTGRES_PASSWORD` — password for `agent-control-db`.
- `AGENT_CONTROL_API_KEYS`, `AGENT_CONTROL_ADMIN_API_KEYS` — required; keys stay on.
- `AGENT_CONTROL_SESSION_SECRET` — signs dashboard sessions.
- `AGENT_CONTROL_SERVER_HOST_PORT` (default `8000`) and `AGENT_CONTROL_BIND`
  (default `127.0.0.1`) — where the dashboard/API is published.

## Reaching the dashboard

By default the port binds to `127.0.0.1`, so the dashboard is reachable only on
the server itself (safe default for production):

```bash
curl http://localhost:8000/health        # {"status":"healthy","version":"..."}
```

To expose it, either set `AGENT_CONTROL_BIND=0.0.0.0` (then set
`AGENT_CONTROL_CORS_ORIGINS` to the real origin and put your own TLS in front),
or add a Caddy route beside the console. Point an agent at it with the upstream
SDK (`AGENT_CONTROL_URL`, `AGENT_CONTROL_API_KEY`).

## How this relates to Zinloop's own Agent Control Plane

Zinloop ships a native control plane on its own stack: migration
`console/db/migrations/020_agent_control_plane.sql`, the `/app/agents` console
page, and the TypeScript SDK in `sdk/typescript/`. It covers the same core ideas
(evaluators, input/output/tool phases, block/warn, enrollment tokens, an
OpenTelemetry callback) and adds per-agent budgets and a task channel.

These remain **two independent control planes** sharing one deployment. There is
no automatic sharing of agents, controls, or events between the upstream server
and the Zinloop console yet, and no single-pane view. A follow-up could forward
upstream control events into the console via a custom observability sink
(upstream supports `register_control_event_sink`); that is separate work.

## Security notes

- Keep API keys enabled. Keyless means any caller is trusted.
- The upstream runtime sees agent inputs/outputs in transit for evaluation, same
  caveat as Zinloop's online runtime (`sdk/typescript/README.md`). The offline
  laptop scanner keeps content local; this does not.

## Attribution

Agent Control is licensed under **Apache License 2.0**, Copyright its authors.
This repo redistributes only configuration that references their published image;
it contains none of their source. See the upstream `LICENSE`/`NOTICE` at
https://github.com/agentcontrol/agent-control.
