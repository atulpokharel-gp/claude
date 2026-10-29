# Zinloop — AI Agent Security, Governance & Visibility

**Find the agents. Understand their access. Apply controls. Monitor the work.**

[Website](https://zinloop.com) · [Free MCP config checker](https://zinloop.com/check) · [Scanner downloads](https://zinloop.com/download) · [Releases](https://github.com/atulpokharel-gp/zinloop-zipax/releases) · [Security deployment guide](docs/deploy.md) · [Zipax guide](docs/zipax.md)

Zinloop is a privacy-conscious platform for managed service providers (MSPs), IT teams, and developers securing AI assistants and Model Context Protocol (MCP) connections. It combines **endpoint discovery** (what is configured on a laptop), **centralized MSP visibility** (which clients and devices have risk), **runtime agent controls** (whether an instrumented model/tool call should proceed), and **opt-in developer analytics** (Zipax).

This repository contains the **Go endpoint scanner**, **Next.js/TypeScript website and MSP console**, **PostgreSQL data layer**, and a **TypeScript agent SDK**. You do **not** need a Python service for Zinloop's native control plane.

> **Scope, not a security guarantee:** Zinloop only sees the applications, configurations, tools, and agent calls that its installed scanner, integrations, and SDK can access. A clean scan or an allowed runtime decision is not proof that a machine, AI model, or MCP server is safe. Some findings are heuristics and require review.

## Contents

- [Why Zinloop](#why-zinloop)
- [Products and capabilities](#products-and-capabilities)
- [Architecture and trust boundaries](#architecture-and-trust-boundaries)
- [Feature and release status](#feature-and-release-status)
- [Quick start](#quick-start)
- [Scanner: discovery, findings and safe remediation](#scanner-discovery-findings-and-safe-remediation)
- [MSP console and device workflows](#msp-console-and-device-workflows)
- [Runtime Agent Control Plane](#runtime-agent-control-plane)
- [Agent collaboration, model choice and budgets](#agent-collaboration-model-choice-and-budgets)
- [Zipax: private analytics and opt-in developer profiles](#zipax-private-analytics-and-opt-in-developer-profiles)
- [Security and privacy boundaries](#security-and-privacy-boundaries)
- [Database, deployment and configuration](#database-deployment-and-configuration)
- [Testing, development and operations](#testing-development-and-operations)
- [Roadmap and known limitations](#roadmap-and-known-limitations)
- [Project structure and documentation](#project-structure-and-documentation)

## Why Zinloop?

Employees increasingly connect Claude Desktop/Claude Code, Cursor, VS Code and similar tools to MCP servers, databases, source-control systems, SaaS applications and local files. Credentials may live in configuration files, permissions may be wider than necessary, and changes can occur without an IT ticket. MSPs need a way to inspect this exposure across customers without collecting every prompt, key or source file.

At the same time, organizations operating *their own* AI agents need a separate control point for **runtime guardrails**, **model allowlists**, **spend reservations** and **shared task coordination**.

Zinloop addresses those as two complementary—but distinct—data flows:

1. **Endpoint discovery:** a local scanner identifies configured MCP servers and risky settings and can optionally upload a **redacted report**.
2. **Runtime governance:** instrumented agents send the *content to be evaluated* to a Zinloop policy API before/after model or tool calls. The server returns `allow`, `warn` or `block` and records verdict metadata.
3. **Developer insights:** Zipax analyzes supported local session logs, uploads bounded usage/scoring metadata on request, and keeps public profiles **off by default**.

## Products and capabilities

| Surface | Audience | What it does | Main entry point |
| --- | --- | --- | --- |
| **Zinloop Security scanner** | Developers, IT, MSP technicians | Discovers supported MCP configs and agent skills; flags risky commands, credentials, permissions, transports, launchers and injection indicators; previews/applies supported keychain fixes | `scanner/` and `zinloop` |
| **MSP Security Console** | MSP owners, technicians, customer viewers | Client/device inventory, scan coverage, findings, Microsoft 365 integration, change tracking, workflows and printable reports | `console/`, `/app` |
| **Free browser MCP grader** | Anyone | Paste a connector config, get local risk findings and share a grade/count summary without sending the pasted config to the server | `/check` |
| **Native Agent Control Plane** | MSP admins, API agent operators | Enroll agents, create input/output/tool controls, view verdict events, configure model policies and budgets, coordinate tasks | `/app/agents`, `/api/control-plane/*` |
| **TypeScript Agent SDK** | Agent developers | Small wrapper/decorator for guarded calls; auto-registration; budget reservations; task/channel methods; optional telemetry callback | `sdk/typescript/` |
| **Zipax** | Developers and MSPs | Local AI coding usage and builder signals; internal company views; consent-based public profiles and leaderboard | `/app/zipax`, `/zipax/settings`, `/p/[slug]` |
| **Optional upstream Agent Control deployment** | Teams needing upstream Python framework adapters | Separate third-party server running alongside Zinloop, not currently synchronized into native Zinloop | `deploy/agent-control/` |

### Typical MSP workflow

1. MSP signs up, enables two-factor authentication and invites authorized teammates.
2. MSP adds a client and creates a **client-scoped laptop upload token**.
3. Technicians download the appropriate Windows/macOS/Linux build, or deploy it through an RMM.
4. The scanner reads supported configurations and emits a local report; managed installs upload redacted scan results.
5. The console shows endpoints, discovered AI/MCP servers, findings, scan completeness, changes and remediation opportunities.
6. Where permitted, the MSP connects Microsoft 365 and reviews relevant application grants.
7. Technicians remediate locally or use an authorized Microsoft 365 action; a follow-up scan verifies the local fix.
8. MSP generates the client report. Separately, API-driven agents can enroll into runtime governance.

## Architecture and trust boundaries

```text
                          Zinloop Security — Next.js / TypeScript
              +-----------------------------------------------+
              | Public website: /, /check, /download, /docs   |
              | MSP console: /app, /app/devices, /app/agents  |
              | Client reports, auth/MFA, team, M365          |
              +----------------------+------------------------+
                                     |
                            tenant-scoped APIs
                                     |
                       +-------------v-------------+
                       | PostgreSQL (Neon or self) |
                       | MSP tenant row isolation |
                       | scans / policies / events |
                       | tasks / cost reservations |
                       +---------------------------+
                             ^               ^
           authorized scan   |               | agent API calls
           uploads only      |               | when SDK enabled
                             |               |
             +---------------+--+       +----+-------------------+
             | Go zinloop        |       | TS SDK / API agents    |
             | on Win/Mac/Linux  |       | input / output / tool  |
             | offline by default|       | shared task channel   |
             +----------+--------+       +------------------------+
                        |
               OS keychain (optional)
               no raw key upload

   Zipax: local coding logs -> aggregated usage/profile metadata ->
           MSP private views; public profile only with developer opt-in

   Optional upstream Agent Control Docker stack:
           separate API, dashboard and database; no native sync yet
```

**Two important distinctions:**

- The **Go scanner** is a local, read-only, offline assessment by default. Uploads, ongoing management, secret edits, and launching servers for tool probes are separate opt-in actions.
- **Runtime guardrails** necessarily process the text submitted by a connected SDK at the configured API endpoint. Zinloop does not claim that this flow is offline, and its native API does not automatically intercept every ChatGPT/Claude/Cursor session.

The PostgreSQL-backed console uses MSP-scoped transactions and row-level security (RLS). Client viewers have additional restricted access in the existing portal. An operator should still validate tenant isolation for each deployment.

## Feature and release status

### Released scanner

**`v0.1.0`**, published **October 28, 2026**, includes the following GitHub release assets:

| Operating system | x64 / AMD64 | ARM64 |
| --- | --- | --- |
| Windows | `zinloop-windows-amd64.exe` | `zinloop-windows-arm64.exe` |
| macOS | `zinloop-darwin-amd64` (Intel) | `zinloop-darwin-arm64` (Apple Silicon) |
| Linux | `zinloop-linux-amd64` | `zinloop-linux-arm64` |

The release also includes `checksums.txt`, `install-windows.ps1` and `install-unix.sh`. These are **standalone executables and install scripts**, not MSI/PKG/DEB/RPM packages. See [v0.1.0 downloads](https://github.com/atulpokharel-gp/zinloop-zipax/releases/tag/v0.1.0) and [scanner signing](docs/signing.md).

### Currently implemented in the repository

- Go config/skill scanning, findings and JSON export, opt-in MCP `tools/list` probes, keychain remediation and service/RMM deployment.
- Public site, browser-side `/check`, MSP/client/device/finding views, scan ingestion, MFA/team workflows and Microsoft 365 checks.
- Native TypeScript Agent Control Plane data model, dashboard, runtime API, basic deterministic evaluators, and agent SDK.
- Zipax local reporting, internal views, opt-in public profiles, custom slugs and leaderboard.
- Demo console without a database (synthetic clients and scans).

**Implemented in source** does **not** mean an installation has been deployed, exercised against every cloud provider, or independently pentested. Exact availability depends on the deployment, configured integrations and permissions.

### Not included or not fully integrated

- The Go CLI does **not** currently expose a committable MCP `lock create/verify` workflow or a full offline attack-graph viewer in this repository's main scanner entry point.
- No automatic sync between the optional upstream Agent Control server and native Zinloop policies/events.
- No universal transparent interception of unmodified third-party AI agents.
- Provider-side model spending caps and production-grade reconciliation are not supplied by reservations alone.
- Paid self-service billing is not yet implemented; account plans can be managed administratively.

## Quick start

### Prerequisites

- **Go 1.24+** to build the scanner from source; use a prebuilt binary otherwise.
- **Node.js 22+** for the Next.js console.
- **PostgreSQL 14+** for persistent MSP accounts, uploads, control-plane state and agent runtime APIs.
- Optional: Docker Compose for a full-stack local deployment; a configured Microsoft Entra application for Microsoft 365.

### 1. Clone the repository

```bash
git clone https://github.com/atulpokharel-gp/zinloop-zipax.git
cd zinloop-zipax
```

### 2. Scan locally (no account required)

**From source:**

```bash
cd scanner
go run ./cmd/zinloop
go run ./cmd/zinloop --json --out scan.json
cd ..
```

**Windows PowerShell (download the release asset first):**

```powershell
.\zinloop-windows-amd64.exe --json --out scan.json
Get-FileHash .\zinloop-windows-amd64.exe -Algorithm SHA256
```

**macOS Apple Silicon (download the release asset first):**

```bash
chmod +x ./zinloop-darwin-arm64
./zinloop-darwin-arm64 --json --out scan.json
shasum -a 256 ./zinloop-darwin-arm64
```

**Linux x64 (download the release asset first):**

```bash
chmod +x ./zinloop-linux-amd64
./zinloop-linux-amd64 --json --out scan.json
sha256sum ./zinloop-linux-amd64
```

Compare the output hash with the corresponding entry in the release's `checksums.txt` **before execution**. The examples display hashes; they do not automatically verify signatures. Follow your organization's executable signing/Gatekeeper/SmartScreen policies.

### 3. Try the console in demo mode

```bash
cd console
npm ci
npm run dev
# Open http://localhost:3000/app
```

Without `DATABASE_URL`, the app shows synthetic demo clients and reports. You can open `/app/import` and load a local `scan.json` in your browser; this file is **not** sent to the console. Persistent account management, runtime registration and control-plane mutations require PostgreSQL.

### 4. Enable a real database-backed console

Use a **local/test PostgreSQL instance** and two roles: owner/admin for migrations, and `zinloop_app` for runtime queries.

```bash
cd console
export DATABASE_ADMIN_URL="postgres://owner:OWNER_PASSWORD@localhost:5432/zinloop"
npm run db:migrate

# Set a strong app-role password out of band as database owner.
# Put the new app-role connection string into DATABASE_URL:
export DATABASE_URL="postgres://zinloop_app:APP_ROLE_PASSWORD@localhost:5432/zinloop"
export APP_SECRET="$(openssl rand -base64 32)"
npm run dev
```

The migration creates `zinloop_app` as a role without login; provision its password securely with your PostgreSQL administrator. Never commit `.env` files or real connection strings. See [Docker deployment](docs/deploy.md) and [Vercel + Neon setup](docs/vercel.md) for complete environment, role and scheduled-job setup.

Once configured, sign up at `/free-scan`, create a client, issue its upload token and use `/app/devices` to inspect scans.

## Scanner: discovery, findings and safe remediation

### Supported config discovery

| AI application | Default supported locations / input |
| --- | --- |
| Claude Desktop | Its OS-specific `claude_desktop_config.json` |
| Claude Code | `~/.claude.json`, project `.mcp.json`, skills and plugins |
| Cursor | `~/.cursor/mcp.json` and project `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code | User MCP settings and project `.vscode/mcp.json` |
| Additional custom configs | Explicit `--extra-config` and `--project` flags |
| Additional skills | Explicit `--extra-skills-dir` |

The scanner handles supported config formats and environmental path redirects, and checks suspicious symlink/world-writable locations. **Not all connectors in cloud-hosted AI products are accessible from the endpoint scanner.** For full discovery details, refer to [scanner/README.md](scanner/README.md).

### What it flags

| Category | Example detections |
| --- | --- |
| Secrets | Plain-text API keys/tokens in config fields, arguments, headers or URLs |
| High privilege | Shell access, overly broad filesystem paths, privileged containers |
| Unsafe networking | Unencrypted remote MCP endpoints, untrusted or unusual package registries |
| Supply chain | Unpinned `npx`/`uvx` packages, direct-source launchers |
| OAuth exposure | Broad scope indicators observable in the config |
| Poisoning / injection | Hidden Unicode and suspicious instruction strings in configs and Claude skills |
| Runtime tool poisoning | Suspicious names/descriptions from opt-in `tools/list` probing |
| Configuration integrity | Redirected, symlinked-outside-home or world-writable config/skills paths |
| Rotation reminders | Credentials previously moved to keychain but not yet confirmed replaced |

These are **signals**, not a complete dependency vulnerability feed, a proven attack chain, or guaranteed prompt-injection detection.

### CLI examples

```bash
# Read-only local assessment
zinloop
zinloop --json --out scan.json
zinloop --project /path/to/repo
zinloop --extra-config /custom/path/mcp.json

# Fails with exit code 2 when a finding meets the threshold
zinloop --fail-on high

# Scans other local user profiles (run with authorized admin/root privileges)
zinloop --all-users

# Explicitly runs configured stdio MCP servers to inspect live tool metadata
zinloop --probe-tools --probe-timeout 5s
```

**Exit codes:** `0` = scan completed without threshold violation; `1` = usage/scan error; `2` = finding met `--fail-on` threshold; `3` = scan completed but configured upload failed. An ordinary scan may complete despite unreadable config locations; inspect the report's config warnings and completeness rather than assuming "no findings" means "fully scanned."

### Move supported plaintext secrets into an OS password store

```bash
zinloop fix-secrets           # dry-run preview, no changes
zinloop fix-secrets --apply   # requires authorization; updates supported configs
zinloop rotate --list         # list previously exposed keys needing rotation
zinloop revert               # review the revert command/help before using
```

Supported stores: **Windows Credential Manager**, **macOS Keychain**, and **Linux Secret Service** where present. For supported environment-variable entries, Zinloop can save a secret in the OS store, verify retrieval, make an owner-restricted backup and replace the launch entry with a `zinloop exec` wrapper. Not every header, argument, URL or application config supports automatic conversion.

**Moving an old key to a keychain does not revoke it.** Rotate or revoke the credential with its actual provider, then rescan. Keep the scanner executable in a stable location if its path was inserted into a server configuration. See the [remediation and rollback guide](scanner/README.md#fix-plain-text-keys).

### Upload a managed endpoint scan

Create a **client upload token** from the MSP client page. Use environment variables or an owner-restricted token file—never embed the token in a public repository or routine shell history.

```bash
export ZINLOOP_TOKEN="zlu_REPLACE_WITH_ISSUED_TOKEN"
zinloop --json --out scan.json --upload https://your-console.example/api/scans
```

For MSP/RMM deployment, use the existing scripts in [scanner/rmm/](scanner/rmm/). They download and verify the chosen release and can schedule daily scans. The standalone scanner also supports the long-running service lifecycle:

```bash
sudo zinloop install --url https://your-console.example --token-file /secure/path/token
zinloop status
zinloop logs --follow
sudo zinloop uninstall --purge
```

Service setup varies by OS: Linux systemd, macOS launchd, and Windows Task Scheduler. See [scanner setup and RMM details](scanner/README.md#install-as-a-long-running-service).

## MSP console and device workflows

The same `console/` Next.js app serves the public site and the signed-in MSP workspace.

| Route | Purpose |
| --- | --- |
| `/app` | MSP overview, client risk and operational work queue |
| `/app/devices` | All discovered endpoints and scan freshness |
| `/app/devices/[id]` | Device metadata, MCP servers, configuration locations, rule findings, skills, probes and remediation guidance |
| `/app/findings` | Search and review security findings across clients |
| `/app/tools` | AI application/MCP server inventory |
| `/app/people` | Observed agent/tool ownership signals |
| `/app/clients/[id]` | One customer's scanner uploads, token administration and integrations |
| `/app/clients/[id]/devices` | Client-only device inventory |
| `/app/clients/[id]/changes` | Configuration/scan changes over time |
| `/app/clients/[id]/report` | Printable client report |
| `/app/import` | Browser-only inspection of a local scan report |
| `/app/downloads` | Windows/macOS/Linux downloads and RMM instructions |
| `/app/agents` | Agent Control Plane, controls, budgets, tasks and events |
| `/app/settings` | Team, sign-in/MFA and organization settings |
| `/app/zipax` | Internal Zipax usage and profiles |
| `/portal` | Restricted client-viewer entry point |

### Microsoft 365 and Entra

A configured Microsoft Graph integration can enumerate selected AI-related enterprise applications and grants and support permission revocation through authorized workflows. Microsoft 365 admin consent and configured API permissions are required. Zinloop **does not read customer mail bodies, files or chats** as part of this inventory workflow. See [docs/m365.md](docs/m365.md).

### Access controls

The console includes email/password sign-in, two-factor setup, team invitations, audit records, and additional read-only client-viewer scoping. Credentials and upload tokens are hashed where supported, and data access uses PostgreSQL RLS inside tenant-scoped transactions. The source contains support for organization roles including owner, member, technician and viewer. Always test roles/authorization with your actual environment.

## Runtime Agent Control Plane

The **native Agent Control Plane** runs *inside the existing Next.js application*. It does not depend on the separately deployable upstream Python Agent Control service.

It is designed for code-controlled agents that deliberately opt in to the Zinloop runtime API:

- **Enrollment:** issue a short-lived (`24h`) MSP- or client-scoped enrollment key in `/app/agents`; a running agent uses it to auto-register and receives its own agent credential.
- **Controls:** define rules once across an MSP tenant or for one agent, applied to an agent's `input`, `output`, `tool` or `all` phases.
- **Decisions:** evaluate text with registered controls, return `allow`, `warn` or `block`, and record rule outcomes without persisting raw evaluated content in the event table.
- **Observability:** review recent verdicts and cost records in the dashboard; optionally emit metadata to OpenTelemetry from SDK callbacks.
- **Governance:** choose per-agent allowed model IDs/preferred model, configure a spending reservation limit and create task-specific budgets.

### Built-in evaluators

| Evaluator | Configuration example | Scope/limitations |
| --- | --- | --- |
| `pii` | `{}` | Heuristic email/SSN-like patterns; not general-purpose DLP |
| `prompt_injection` | `{}` | Checks selected instruction-override/role-spoofing phrases; bypasses remain possible |
| `regex` | `{"pattern":"confidential"}` | Restricted safe subset; no arbitrary nested regexes |
| `list` | `{"terms":["do-not-share","internal-only"]}` | Matches configured terms |
| `json` | `{"blockedKeys":["password"]}` | Checks top-level JSON keys and optional validity rules |
| `sql` | `{}` | Static checks for destructive/unbounded/privileged SQL patterns; **never executes SQL** |

Controls can **block** or **warn**. Custom functions can be added as *local SDK evaluators*, and new centrally managed evaluator types require a reviewed server adapter. This is not arbitrary user-code execution inside the console.

### Enroll an agent and protect model/tool calls

1. Sign in to a real PostgreSQL-backed instance at `/app/agents`.
2. Create an enrollment token; copy it **once** into your agent runtime's secret store.
3. Configure the runtime with `ZINLOOP_URL`, `ZINLOOP_AGENT_NAME` and either `ZINLOOP_ENROLLMENT_TOKEN` (first time) or a persisted `ZINLOOP_AGENT_TOKEN`.
4. Import the TypeScript SDK source from `sdk/typescript/index.ts` into a compatible TS project (it is **not published as an npm package** here).
5. Wrap the model/tool call and return the provider's reported usage cost.

```ts
import { ZinloopAgent } from "./sdk/typescript/index"; // adjust import path

const agent = new ZinloopAgent({
  url: process.env.ZINLOOP_URL!,
  name: process.env.ZINLOOP_AGENT_NAME || "review-agent",
  framework: "custom",
  agentToken: process.env.ZINLOOP_AGENT_TOKEN,
  enrollmentToken: process.env.ZINLOOP_ENROLLMENT_TOKEN,
});

const answer = await agent.run(
  {
    input: "Review this proposed change for risk",
    requestedModel: "YOUR_APPROVED_PROVIDER_MODEL_ID",
    maxUsd: 0.05,
  },
  async (selectedModel) => {
    // Your existing OpenAI/Anthropic/provider SDK does the actual inference.
    const result = await callYourProvider({
      model: selectedModel,
      maxOutputTokens: 500,
    });
    return {
      value: result.text,
      outputText: result.text,
      costUsd: result.actualUsdCost,
    };
  }
);
```

This is an **integration pattern**, not a drop-in provider adapter: implement `callYourProvider` with your existing model client and accurate provider usage accounting.

Decorator-style existing function protection is also available with `agent.guard(fn, options)`; see [TypeScript SDK documentation](sdk/typescript/README.md) for a tool example and the exact runtime payloads.

### Runtime API

| Route | Authentication | Purpose |
| --- | --- | --- |
| `POST /api/control-plane/register` | Short-lived `zle_...` enrollment key in request body | Register agent and return scoped `zla_...` credential |
| `POST /api/control-plane/runtime` | `Authorization: Bearer zla_...` | Evaluate, reserve/settle, claim/list/renew/finish tasks, message and poll |
| `GET /api/control-plane/controls` | Signed-in authorized MSP session | Read configured controls |
| `POST /api/control-plane/controls` | Owner/member session, same-origin request | Create a control |

The runtime API's `action` values include `evaluate`, `reserve`, `settle`, `claim`, `tasks`, `heartbeat`, `finish`, `message` and `poll`. Treat agent tokens as secrets; do not use endpoint-upload `zlu_...` tokens in place of agent runtime credentials.

## Agent collaboration, model choice and budgets

A task is a shared coordination record that connected runtimes can access by API. It has a title, description, optional client scope and target agent, preferred model, status, assigned agent, spend limit and messages. Eligible agents may discover, claim and update tasks, publish progress/handoff/result messages and poll the channel.

```ts
const { tasks } = await agent.tasks();
const { task } = await agent.claim();

if (task) {
  await agent.message(task.id, "Dependency review complete.", "progress");
  await agent.heartbeat(task.id); // renew 15-minute lease during long work
  await agent.message(task.id, "Ready for a second agent to review.", "handoff");
  const { messages } = await agent.poll(task.id);
  await agent.finish(task.id, "done");
}
```

### Model and spend enforcement

- An operator sets per-agent model choices/allowlists and a budget in `/app/agents`.
- A task can pin a model and spending limit, optionally targeting one registered agent.
- Before invoking an external model, the SDK asks the server to **reserve** a maximum USD amount. Database transactions account for reserved and previously reported spending.
- After the call, the SDK reports the **actual** cost and settles the reservation.
- Events and dashboard surfaces show reservations/spending and policy decisions.

**Important limits:** reservation accounting is not an external provider's billing ceiling. Costs are supplied by integrated runtimes and may be late, inaccurate or greater than reservations; use provider-side quotas, model token ceilings and reconciliation. Abandoned reservations, task lease expiry, multi-agent scheduling and cross-provider cost normalization need more operational hardening.

**Not automatic control of consumer apps:** Zinloop cannot see or take over someone else's ChatGPT or Claude web chats. To coordinate Claude-based and OpenAI-based agents, run them through supported APIs/integrations that explicitly use the Zinloop SDK/channel.

## Zipax: private analytics and opt-in developer profiles

Zipax is Zinloop's developer-facing analytics/profile module, **not** a reason to make private MSP security data public. It reuses the platform identity/storage boundary but has a separate claim-and-publication flow.

Supported local session analysis currently documents **Claude Code** and **OpenAI Codex** local logs. It derives usage buckets (input/output/cache tokens, estimated cost and model/tool labels), private builder scores (steering, execution, engineering, product instinct, planning), and a per-device user hash. Prompts, generated source code and full absolute project paths are not uploaded as ordinary Zipax usage data.

```bash
zinloop zipax                 # local summary
zinloop zipax --json          # inspect report
# optional: explicitly authorized upload
ZINLOOP_TOKEN="zlu_REPLACE_ME" zinloop zipax --upload https://your-console.example/api/zipax/usage
```

Views include:

- `/app/zipax` and `/app/zipax/team` — MSP-internal usage and aggregated profiles.
- `/portal/zipax` — client-scoped view.
- `/zipax/settings` — developer claim, visibility choices, slug and profile controls.
- `/p/[slug]` and `/leaderboard` — public pages that only display **opted-in** fields.

Public listing, names, scores and sessions are **private/off by default** and require developer action. Local usage coverage differs across coding applications; do not assume Cursor/Copilot token accounting is implemented merely because the scanner discovers their MCP configs. See [Zipax architecture and privacy](docs/zipax.md).

## Security and privacy boundaries

| Data/action | Default behavior | When can it leave the device or change state? |
| --- | --- | --- |
| Laptop MCP config content | Parsed locally; secret **values** are redacted from scan reports | Only the redacted report is uploaded when `--upload`/managed mode is configured |
| Raw prompts and coding-session contents | Not part of ordinary scanner uploads | Runtime SDK explicitly sends evaluated text to the configured Zinloop API; Zipax sends derived metadata on authorized upload |
| Standalone scanner telemetry | No network telemetry by default | Explicit managed scan upload; operational services/RMM also upload when configured |
| MCP runtime tool introspection | **Disabled** by default | `--probe-tools` starts configured stdio servers; treat it as executing third-party code |
| Credential edits | **Disabled** by default | Explicit `fix-secrets --apply`/`rotate`; back up and test restores |
| Microsoft 365 app/grant changes | Not implicit in scan | Authorized Graph connection and explicit permitted revocation workflow |
| Agent guardrail evaluations | No agent interception without SDK | The evaluated text is processed by your configured API endpoint; event rows retain outcomes/reasons, not the full content |
| Collaboration messages | No shared messages until an agent posts | Messages are intentionally stored and visible to authorized workspace viewers; avoid secrets or raw conversations |
| Zipax public developer profile | **Off by default** | Explicit profile claim and selected sharing preferences |
| OpenTelemetry | Not required or auto-exported by the SDK | Integrating application opts into the metadata callback/exporter |

**Security responsibilities:** keep enrollment/agent/upload tokens private; protect `DATABASE_URL`, `DATABASE_ADMIN_URL`, `APP_SECRET` and provider secrets; use HTTPS; require MFA for privileged staff; review RLS, API authorization, backup/restore, signing and least-privilege Graph permissions before onboarding production customers.

## Database, deployment and configuration

The native console uses **Next.js + PostgreSQL** and migrations under `console/db/migrations/`, including `020_agent_control_plane.sql`. The application role `zinloop_app` is expected to be subject to row-level security. Migrations and certain administrative jobs require a more privileged owner connection.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Tenant-scoped application-role PostgreSQL connection; enables production console |
| `DATABASE_ADMIN_URL` | Privileged connection for schema migration and administrative jobs |
| `DB_APP_PASSWORD` | Provisioning application-role credentials in deployment setup |
| `APP_SECRET` | Application encryption/signing secret, including 2FA-related state |
| `CONSOLE_URL` | Public origin used for callbacks, links and deployment |
| `CRON_SECRET` | Protect scheduled job endpoints where configured |
| `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | Optional Microsoft 365 integration |
| `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` | Optional separate Microsoft work-account sign-in |
| `SMTP_URL` / `MAIL_FROM` | Email, invitation and alert delivery when configured |
| `DOWNLOAD_BASE_URL` | Optional override for release asset download redirects |
| `ZINLOOP_URL` | SDK: URL of configured native control plane |
| `ZINLOOP_ENROLLMENT_TOKEN` / `ZINLOOP_AGENT_TOKEN` | SDK: initial enrollment / registered runtime credential |
| `ZINLOOP_TOKEN` | Scanner: client-scoped scan/Zipax upload credential |

Deploy choices:

- **Local development/demo:** `cd console && npm ci && npm run dev`. Without `DATABASE_URL`, no persistent MSP accounts/agent runtime state.
- **Docker + Postgres + Caddy:** [docs/deploy.md](docs/deploy.md), [docker-compose.yml](docker-compose.yml).
- **Vercel + Neon:** [docs/vercel.md](docs/vercel.md). Preview builds can run demo data while production uses its own secrets and migrations.
- **Optional upstream Agent Control:** [deploy/agent-control/README.md](deploy/agent-control/README.md). This pulls upstream images, exposes a *separate* dashboard/API and uses a *separate* database. It is **not** federated with native Zinloop.

Do not assume the upstream Agent Control Docker deployment automatically supplies native MSP policies, agents or events. Avoid putting staging and production on the same database.

## Testing, development and operations

```bash
# Go scanner tests and vetting
cd scanner
go test ./...
go vet ./...

# Next.js/API/DB helper tests and production validation
cd ../console
npm ci
npm test
npm run build
npm run typecheck

# Only when a disposable PostgreSQL test database is available:
# TEST_DATABASE_ADMIN_URL=postgres://... npm test
```

GitHub Actions workflows in `.github/workflows/` exercise scanner builds (including OS-specific checks), the console and the Docker stack. Some database integration tests require `TEST_DATABASE_ADMIN_URL`; validate migration/RLS behavior against an actual test PostgreSQL role, not only type checks.

For production operations, also verify:

- Client-to-client and MSP-to-MSP isolation; viewer read restrictions; authentication/MFA.
- Enrollment token expiry, agent token revocation, policy authorization, input limits.
- Scanner redaction, partial/unreadable configs, per-platform credential-store and rollback behavior.
- Guardrail allow/warn/block behavior and prompt/PII false positives.
- Concurrent budget reservations, missing settle events, task claims/leases, provider cost reconciliation.
- RMM updates, binary checksums/signatures, scheduled-job health and restore from backup.
- Microsoft 365 grants and successful provider-side revocation verification.

See also [pentest readiness](docs/pentest-readiness.md), [signing](docs/signing.md), [Microsoft 365](docs/m365.md) and [operations/deployment](docs/deploy.md).

## Roadmap and known limitations

The current repo is a functional foundation, not a promise of comprehensive detection or universal third-party coverage.

| Priority | Next work | Why |
| --- | --- | --- |
| High | Independent cross-platform endpoint/RMM security testing and signed binaries | Trustworthy MSP distribution and safe remediation |
| High | Stronger runtime secrets handling, evaluator coverage and tenant/auth audits | Heuristic detection does not replace mature DLP/agent security |
| High | Hard budget enforcement with provider integration, expired reservation cleanup and billing reconciliation | Prevent accounting drift and cost surprises |
| High | Production collaboration lease management, long-running workers and robust cancellations | Reliable parallel-agent orchestration |
| Medium | Commit-friendly MCP lockfile/drift verification and optional offline attack-path explorer | Detect unauthorized connector changes and combined risk |
| Medium | More package provenance/advisory evaluation using explicit offline data snapshots | Better supply-chain visibility without hidden telemetry |
| Medium | Supported integrations/adapters for more agent frameworks, model providers and MCP endpoints | Wider adoption without universal-integration claims |
| Medium | Explicit bridge/sync to optional upstream Agent Control | Avoid two isolated policy dashboards |
| Medium | Self-service subscriptions, billing and MSP margin workflows | Commercial readiness |
| Medium | More Zipax coding-tool source coverage and score validation | Fairer and more complete developer analytics |

If you intend to publish or invite outside contributions as **open-source software**, add and verify an appropriate root `LICENSE` file first; no root license is present at the time of writing.

## Project structure and documentation

```text
zinloop-zipax/
├── README.md                       # You are here
├── scanner/                        # Go CLI, discovery, security rules, keychain fixes
│   ├── cmd/zinloop/                # Entry point and OS service commands
│   ├── internal/                   # Discover, rules, skillscan, toolprobe, vault, report, Zipax
│   ├── rmm/                        # PowerShell and shell install scripts
│   └── README.md                   # Full scanner and remediation reference
├── console/                        # Next.js public site and MSP dashboard
│   ├── app/(site)/                 # Marketing site, browser checker, downloads, Zipax public views
│   ├── app/(console)/app/          # MSP/client/device/finding/agent-control views
│   ├── app/api/                    # Scan, Zipax, M365, runtime and other APIs
│   ├── db/migrations/              # RLS schema and application migrations
│   ├── lib/                        # Auth, tenant DB, rules, control plane, reports
│   └── scripts/                    # Migration, maintenance and admin tasks
├── sdk/typescript/                 # Framework-neutral agent runtime wrapper SDK
├── deploy/                         # Docker/system deployment and optional upstream service
│   └── agent-control/              # Independent upstream Agent Control stack
├── docs/                           # Detailed deployment, privacy and integration guides
└── .github/workflows/              # CI, release and deployment pipelines
```

Useful references:

- [Go scanner: all flags, supported configs, rules, OS keychain and RMM](scanner/README.md)
- [TypeScript agent SDK: registration, decorators, tasks and telemetry](sdk/typescript/README.md)
- [Zipax: developer usage, claims and public-profile privacy](docs/zipax.md)
- [Microsoft 365 / Entra setup](docs/m365.md)
- [Self-hosted Docker deployment](docs/deploy.md)
- [Vercel and Neon deployment](docs/vercel.md)
- [Scanner signing](docs/signing.md)
- [Pentest readiness](docs/pentest-readiness.md)
- [Optional independent upstream Agent Control server](deploy/agent-control/README.md)

---

**Zinloop's principle:** give MSPs visibility into AI-agent exposure, give developers control over their own reputation data, and let organizations apply explicit runtime policies to agents they operate—without pretending that endpoint scanning, policy evaluation and public profiles have the same privacy boundary.
