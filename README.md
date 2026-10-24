# Agent Guard (working name)

Security for AI agents, built for MSPs that look after mid-sized companies.
It finds every AI agent and MCP server a client uses, shows what each one can
reach, and helps shut down the risky ones.

This repository holds the first demo:

| Folder | What it is | Status |
| --- | --- | --- |
| [`scanner/`](scanner/) | `agentscan`, a small Go program that finds MCP server configs on a laptop and flags risky settings | Working prototype |
| [`console/`](console/) | The MSP web console (Next.js). Runs as a demo with made-up clients, or with Postgres: sign-in, clients, and laptops sending their scans | Working prototype |

## Try it

**Scan a computer** (needs Go 1.24+):

```sh
cd scanner
go run ./cmd/agentscan                 # readable summary
go run ./cmd/agentscan --json --out scan.json
```

To fix what it finds, `go run ./cmd/agentscan fix-secrets` previews moving
plain-text keys into the computer's password store; see the
[scanner README](scanner/README.md#fix-plain-text-keys).

The scan itself only reads files. It changes nothing, sends nothing over the
network, and never writes key or password values into its report.

**Run the console** (needs Node 22+):

```sh
cd console
npm install
npm run dev     # then open http://localhost:3000
```

Without a database it runs as a demo with made-up clients. Open **Open a scan
file** and drop in the `scan.json` from the step above, or click **Try a sample scan**.

**Run the console with a database** (needs Postgres 14+):

```sh
cd console
# 1. Create the tables, as the database owner
export DATABASE_ADMIN_URL=postgres://owner@host/agentguard
npm run db:migrate
# 2. Give the app role a password (the migration creates the role without one)
psql "$DATABASE_ADMIN_URL" -c "alter role agentguard_app login password '...'"
# 3. Create your MSP account; prints a one-time password
npm run db:create-msp -- "Your MSP" you@example.com
# 4. Run the console as the app role
export DATABASE_URL=postgres://agentguard_app:...@host/agentguard
npm run build && npm start
```

Sign in, add a client, and create an upload token on the client's page. Then
on each laptop, usually through your RMM tool:

```sh
AGENTGUARD_TOKEN=agu_... agentscan --upload https://your-console/api/scans
```

Each MSP's data is kept apart by Postgres row-level security: the console's
database role can only see rows of the MSP that is signed in. For local http
testing set `ALLOW_HTTP_COOKIES=1`; never set it in production.

## Tests

```sh
cd scanner && go test ./...
cd console && npm test && npm run build && npm run typecheck
```

The console's database tests run when `TEST_DATABASE_ADMIN_URL` points at a
Postgres server (they create and drop their own database).

CI runs all of these on every pull request.

## What's next

See the build plan for the full roadmap. Next up: a real Microsoft 365
connector (read-only Graph API), sign-in rate limiting and multi-factor
sign-in, and a PDF report per client.
