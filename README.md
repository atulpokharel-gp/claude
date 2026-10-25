# Zinloop Security

Security for AI agents, built for MSPs that look after mid-sized companies.
It finds every AI agent and MCP server a client uses, shows what each one can
reach, and helps shut down the risky ones.

| Folder | What it is |
| --- | --- |
| [`scanner/`](scanner/) | `zinloop`, a small Go program that finds AI connector (MCP server) configs on laptops, flags risky settings and moves plain-text keys into the OS keychain. [`scanner/rmm/`](scanner/rmm/) has install scripts for RMM tools |
| [`console/`](console/) | The website and MSP console (Next.js + Postgres): sign-up, two-factor sign-in, team invites, clients, laptop scans, Microsoft 365 checks and a printable client report |
| [`docs/`](docs/) | [Deploying](docs/deploy.md) and [setting up Microsoft 365](docs/m365.md) |

The website is at `/`, the console at `/app`. The free public checker is at
`/check`: anyone pastes an AI connector config and gets a grade they can share.
It runs in the browser with the same rules as the scanner (`console/lib/mcp-check.ts`).
`npm run research:configs` counts risky configs in public GitHub repos and saves
only totals, for a research report. Payments aren't built yet; plans
are set by hand with `npm run db:set-plan`.

## Try it

**Scan a computer** (needs Go 1.24+):

```sh
cd scanner
go run ./cmd/zinloop                 # readable summary
go run ./cmd/zinloop --json --out scan.json
```

To fix what it finds, `go run ./cmd/zinloop fix-secrets` previews moving
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
export DATABASE_ADMIN_URL=postgres://owner@host/zinloop
npm run db:migrate
# 2. Give the app role a password (the migration creates the role without one)
psql "$DATABASE_ADMIN_URL" -c "alter role zinloop_app login password '...'"
# 3. Run the console as the app role
export DATABASE_URL=postgres://zinloop_app:...@host/zinloop
export APP_SECRET=$(openssl rand -base64 32)
npm run build && npm start
```

Then open the site and click **Get a free scan** to create an account, or
create one from the command line with `npm run db:create-msp -- "Your MSP" you@example.com`.
For a real server, use Docker: see [docs/deploy.md](docs/deploy.md).

Sign in, add a client, and create an upload token on the client's page. Then
on each laptop, usually through your RMM tool:

```sh
ZINLOOP_TOKEN=zlu_... zinloop --all-users --upload https://your-console/api/scans
```

or use the ready-made scripts in [`scanner/rmm/`](scanner/rmm/), which also
check the download's checksum and can schedule a daily scan.

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

Payments (Stripe), email delivery for invites, alerts when a new risky agent
appears, Google Workspace, and a live gateway that checks agent actions as they
happen.
