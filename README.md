# Agent Guard (working name)

Security for AI agents, built for MSPs that look after mid-sized companies.
It finds every AI agent and MCP server a client uses, shows what each one can
reach, and helps shut down the risky ones.

This repository holds the first demo:

| Folder | What it is | Status |
| --- | --- | --- |
| [`scanner/`](scanner/) | `agentscan`, a small Go program that finds MCP server configs on a laptop and flags risky settings | Working prototype |
| [`console/`](console/) | The MSP web console (Next.js) with made-up sample clients, plus an upload page for real `agentscan` reports | Clickable demo, no backend yet |

## Try it

**Scan a computer** (needs Go 1.24+):

```sh
cd scanner
go run ./cmd/agentscan                 # readable summary
go run ./cmd/agentscan --json --out scan.json
```

The scanner only reads files. It changes nothing, sends nothing over the
network, and never writes key or password values into its report.

**Run the console** (needs Node 22+):

```sh
cd console
npm install
npm run dev     # then open http://localhost:3000
```

Open **Upload a laptop scan** and drop in the `scan.json` from the step above,
or click **Try a sample scan**.

## Tests

```sh
cd scanner && go test ./...
cd console && npm test && npm run build && npm run typecheck
```

CI runs all of these on every pull request.

## What's next

See the build plan for the full roadmap. Next up after this demo: a real
Microsoft 365 connector (read-only Graph API), a database with per-client
isolation, and the scanner uploading reports to the console.
