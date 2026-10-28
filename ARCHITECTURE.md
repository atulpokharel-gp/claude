# Zinloop Security — System Architecture

Living architecture + status doc. The product vision lives in `PLANANDVISION.MD`;
this file records what is **actually built**, **how it works**, and **what is left**.

**Rules for this doc**
- Source of truth is the code, not the vision. If code and this doc disagree, fix this doc.
- Never mark something Done unless it exists and works in the tree. Use: ✅ Done · 🟡 Partial · ⬜ Not started.
- When you build or change something, update the matching section **and** add a dated entry to the Build Log at the bottom.
- Keep claims grounded: name the file/dir. No aspirational prose.

Last synced to code: 2026-10-28 (branch `fix/deploy-messaging-and-docs`).

---

## 1. System overview

Three connected layers, one repo (`github.com/atulpokharel-gp/zinloop-zipax`).

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer A — Endpoint Scanner (Go)            scanner/                    │
│   Reads AI/MCP configs on a device, finds risky settings & secrets,    │
│   fixes secrets into the OS keystore, optionally runs as a service,    │
│   optionally uploads a REDACTED report to the console.                 │
└───────────────┬───────────────────────────────────────────────────────┘
                │  POST redacted JSON report  (scoped upload token)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Layer B — MSP Console (Next.js App Router) console/                    │
│   Multi-tenant SaaS: MSP accounts, clients, devices, scans, findings,  │
│   remediation, policies, alerts, M365 checks, reports, RMM/PSA.        │
│   Postgres (Neon) + server-side sessions + TOTP MFA. Hosted on Vercel. │
└───────────────┬───────────────────────────────────────────────────────┘
                │  shares code / auth with
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Layer C — Public tools (part of console/app/(site))                    │
│   Free browser-only MCP grader (/check), scanner download, docs,       │
│   marketing pages, Zipax public developer profiles + leaderboard.      │
└─────────────────────────────────────────────────────────────────────┘
```

**Primary data flow:** device scan → (optional) authorized upload → console stores per client/device → MSP triages findings → remediation (local fix via scanner, or M365 revocation) → follow-up scan verifies → report.

---

## 2. Repository layout

| Path | What it is |
|---|---|
| `scanner/` | Go module, the `zinloop` endpoint scanner + RMM install scripts |
| `console/` | Next.js App Router app: MSP console, portal, public site, public API |
| `deploy/` | `deploy.sh`, backup helpers |
| `docs/` | Project docs: deploy, M365, signing, pentest-readiness, vercel, zipax |
| `docker-compose.yml` | Local Postgres / stack for dev |
| `PLANANDVISION.MD` | The aspirational product spec (not status) |
| `captures/`, `hype-assets/`, `vo-openai/`, `generate-voice.py` | Marketing/media assets, not product code |

---

## 3. Layer A — Endpoint Scanner (`scanner/`)

Go 1.24, module `github.com/atulpokharel-gp/zinloop-zipax/scanner`. Entry: `cmd/zinloop/main.go`.
Default behavior is a **read-only, offline** scan — it only reads files and sends nothing unless `--upload` is passed.

### 3.1 Commands (wired in `cmd/zinloop/main.go` `run()`)
| Command | Status | Notes |
|---|---|---|
| `zinloop` / `zinloop scan` (default) | ✅ | Flags below |
| `fix-secrets` [`--apply`] | ✅ | `runFix` → `internal/fix`, `internal/vault` |
| `rotate` [`--list`] | ✅ | `runRotate` |
| `revert` | ✅ | `runRevert` — undo a fix |
| `zipax` | ✅ | `runZipax` → `internal/zipax` (developer-profile feature) |
| `install`/`uninstall`/`status`/`logs`/`service` | ✅ | Managed service; per-OS `service_{windows,darwin,linux,other}.go` |
| `__exec` launcher | ✅ | `discover.LauncherSubcommand`, used by tool-probe |
| `lock create/verify/diff/update` | ⬜ | MCP lockfile not implemented |
| `graph --format html` | ⬜ | Attack-graph exporter not implemented |

**Scan flags (implemented):** `--json`, `--out`, `--home`, `--fail-on {high,medium,low}`, `--upload`, `--token-file`, `--all-users`, `--users-dir`, `--probe-tools`, `--probe-timeout`, `--project` (repeatable), `--extra-config` (repeatable), `--extra-skills-dir` (repeatable), `--version`.

### 3.2 Internal packages (`scanner/internal/`)
| Package | Role | Status |
|---|---|---|
| `discover/` | Find config locations, parse MCP configs, launcher | ✅ `locations.go`, `parse.go`, `scan.go`, `launcher.go` |
| `rules/` | Detection engine (risk rules over parsed configs) | ✅ `rules.go` (single ruleset file) |
| `fix/` | Secret remediation: preview/apply/revert | ✅ |
| `vault/` | OS password stores (`Keyring`) | ✅ Windows Credential Manager / macOS Keychain / Linux Secret Service |
| `toolprobe/` | Opt-in: start stdio MCP servers, scan live tool lists for hidden instructions | ✅ gated behind `--probe-tools` |
| `skillscan/` | Scan local skill/plugin manifests | ✅ |
| `report/` | Build the report model / JSON | ✅ |
| `zipax/` | Developer-profile (`profile.go`) | ✅ |

### 3.3 RMM (`scanner/rmm/`)
`install-unix.sh`, `install-windows.ps1`. ✅ basic installers. Signature/checksum verification and enrollment hardening tracked in gaps.

### 3.4 Layer A — what's left
- ⬜ MCP lockfile (`zinloop.lock.json`) + `lock create/verify/diff/update` + drift detection (vision §13)
- ⬜ Local attack-graph exporter `graph --format html` (vision §14)
- 🟡 Package-security checks (typosquatting, unpinned versions, advisory DB) — confirm depth in `rules.go` (vision §11 "Package security")
- 🟡 RMM enrollment: scoped/revocable tokens, signature verification (vision §19)

---

## 4. Layer B — MSP Console (`console/`)

Next.js App Router + TypeScript. `middleware.ts` at root; config `next.config.ts`, `vercel.json`. Postgres access via `lib/db.ts`.

### 4.1 Route groups (`console/app/`)
- **`(site)`** public marketing + tools: `check` (+`check/r`), `docs`, `free-scan`, `how-it-works`, `join/[token]`, `leaderboard`, `live`, `login`, `msps`, `p/[slug]`, `pricing`, `privacy`, `security`, `terms`, `unsubscribe`, `zipax` (+`claim`, `settings`).
- **`(console)`** authenticated MSP app under `/app`: `clients`, `import`, `people`, `settings`, `tools`, `zipax`.
- **`(portal)`** client-facing portal: `portal/account`, `portal/report`, `portal/zipax`.
- Top-level: `check/badge`, `check/card`, `download/[file]`.

### 4.2 API routes (`console/app/api/`)
`auth/microsoft/{start,callback}`, `cron/{daily,mail,schedules}`, `health`, `m365/callback`, `public/pulse`, `scans` (scanner upload ingest), `unsubscribe`, `zipax/usage`.

### 4.3 Library modules (`console/lib/`) — the service layer
Auth/session: `auth.ts`, `session.ts`, `totp.ts` (MFA), `microsoft-sso.ts`, `sso-flow.ts`, `accounts.ts` (MSP + users + invites + roles), `identities.ts`, `ratelimit.ts`, `crypto.ts`, `secrets.ts`.
Core domain: `scan-import.ts` (ingest), `data.ts`, `store.ts`, `types.ts`, `risk.ts`, `changes.ts`, `insights.ts`, `remediation.ts`, `policies.ts`, `alerts.ts`, `report.ts`, `health.ts`, `downloads.ts`, `pulse.ts`, `schedules.ts`, `cron.ts`, `audit.ts`, `request-audit.ts`.
Integrations: `m365.ts` (+`m365-fake.ts`), `mcp-check.ts` (grader engine, also used by `/check`), `rmm.ts`, `psa.ts`, `zipax.ts`.
Test coverage: many `*.test.ts` colocated (auth/session via security.test.ts, cron, email, health, insights, m365, mcp-check, policies, psa, pulse, remediation, report, rmm, schedules, zipax, db, changes, console).

### 4.4 Auth, tenancy, RBAC
- ✅ MSP self-serve signup on free plan, owner user created (`accounts.ts` `createMsp`-style flow).
- ✅ Server-side sessions (`session.ts`), HTTP-only cookies, rate limiting (`ratelimit.ts`).
- ✅ TOTP MFA (`totp.ts`, `totp_enabled_at`).
- ✅ Microsoft sign-in (`microsoft-sso.ts`, `auth/microsoft/*`).
- 🟡 **RBAC roles** implemented: `owner`, `member`, `technician`, `viewer` (client-scoped). Vision asks for Owner/Admin/Security Analyst/Technician/Read-only Auditor — current set is a simpler 4-role model (`member`≈admin, `viewer`≈client auditor; no distinct Analyst).
- ✅ Invites: team (`member`/`technician`) and client-scoped `viewer` (`accounts.ts` `createInvite`/`makeInvite`, `invites` table, `join/[token]`).
- Tenancy enforced in service layer via `msp_id`/`client_id` scoping. ⬜ Postgres row-level security not confirmed in migrations — verify before claiming (vision §20).

### 4.5 Findings model (current)
`lib/types.ts`: `Finding = {ruleId, severity, title, detail, fix}`, `Severity = high|medium|low|none`. `Agent = {kind: mcp-server|copilot-agent|oauth-app, source: Laptop scan|Microsoft 365, reach[], findings[], revocable, people[]...}`.
This is simpler than vision §11's full finding model (no per-finding uid/confidence/detection-method/status-lifecycle on the type). Workflow status is tracked separately via `remediations` / `seen_findings` tables.

### 4.6 Layer B — what's left
- ⬜ Attack-path graph UI (no React Flow / attack-path code in `app`/`lib`/`components`) (vision §14)
- ⬜ Real billing/subscriptions (only referenced in `sample-data.ts`; `pricing` is marketing) (vision §8/§20 "Subscription records")
- 🟡 Full 5-role RBAC + "require MFA for privileged accounts" (vision §7)
- 🟡 Dedicated console nav for AI applications / MCP servers / Credentials / Attack Paths as first-class sections (today surfaced via `clients`/`people`/`tools`)
- ⬜ Confirm/add Postgres RLS + cross-tenant isolation tests (vision §20/§25)

---

## 5. Layer C — Public tools

- ✅ **`/check` MCP grader** — browser-facing grader page (`app/(site)/check`), engine `lib/mcp-check.ts`. `check/r` result view, `check/badge`, `check/card` for shareable summary. Verify client-only analysis + redaction guarantees against vision §6 privacy rules.
- ✅ **Scanner download** — `app/download/[file]`, `lib/downloads.ts`, `app/(site)/free-scan`.
- ✅ **Docs** — `app/(site)/docs` (+ `docs/*.md` in repo).
- ✅ **Zipax public profiles + leaderboard** — `app/(site)/zipax`, `leaderboard`, `p/[slug]`, `live`; `public/pulse` API.
- 🟡 Dedicated marketing pages exist (`msps`, `pricing`, `privacy`, `security`, `how-it-works`); `/product` and `/mcp-security` from vision §5 not present as named routes.

---

## 6. Data model (Postgres, `console/db/migrations/`)

18 migrations (`001_init` … `018_zipax_profile_privacy`). Tables:

**MSP/tenancy:** `msps`, `users`, `invites`, `sessions`, `client_policies`, `clients`, `devices`.
**Scanning:** `scans`, `seen_findings`, `scan_changes`, `risk_snapshots`, `upload_tokens`.
**Remediation/ops:** `remediations`, `report_schedules`, `alerts`, `job_runs`, `outbox`, `audit_log`, `rate_limits`.
**Integrations:** `m365`-related (`microsoft_sign_in`), `rmm_integrations`, `rmm_device_links`, `psa_integrations`, `psa_tickets`.
**Public/Zipax:** `public_pulse`, `user_identities`, `paxel_*` renamed to `zipax` (`017_rename_paxel_to_zipax`): `paxel_profile_prefs`, `paxel_profile_scores`, `paxel_usage_events`, `paxel_user_claims`.

Note: migrations are additive. ⬜ No dedicated `mcp_servers` / `mcp_tools` / `attack_path_*` / `subscriptions` tables yet (vision §20).

---

## 7. Cross-cutting concerns

- **Privacy (vision §24):** scanner offline by default; upload only with `--upload` + scoped token; secrets go to OS keystore via `vault`, redacted in reports. `/check` is browser-only. (Enforcement points to re-verify when touching those paths.)
- **Auth:** server-side sessions + TOTP + Microsoft SSO.
- **Hosting/CI:** Vercel (`vercel.json`, `docs/vercel.md`, `console/scripts/vercel-migrate.ts`); release signing (`docs/signing.md`); GitHub Actions for releases (recent commits add Releases-page → scanner-files flow).
- **Cron:** `app/api/cron/{daily,mail,schedules}` for scheduled scans/mail/report schedules.

---

## 8. Gap analysis vs vision (by spec section)

| Vision § | Area | Status |
|---|---|---|
| §5 | Marketing site | 🟡 most pages exist; missing `/product`, `/mcp-security` |
| §6 | Public MCP grader `/check` | ✅ present; reverify browser-only + redaction |
| §7 | MSP auth + MFA + roles | 🟡 auth/MFA ✅; 4-role RBAC vs 5 in spec |
| §8 | MSP dashboard | 🟡 console exists; summary cards/visualizations depth to verify |
| §9 | Client management | ✅ `clients` + client-scoped viewers |
| §10 | Cross-platform scanner | ✅ scan/discover/service across OSes |
| §11 | Detection engine | 🟡 core rules ✅; package-security + full finding model partial |
| §12 | Credential remediation | ✅ fix-secrets/rotate/revert + OS keystores |
| §13 | Lockfile + drift | ⬜ not started |
| §14 | Attack-path graph | ⬜ not started (scanner export + console UI) |
| §15 | Continuous monitoring | ✅ managed service install/uninstall/status |
| §16 | Microsoft 365 | ✅ sign-in + `m365.ts`; assess/revoke depth to verify |
| §17 | Findings/remediation console | 🟡 remediation lib + tables; workflow UI depth to verify |
| §18 | Reporting/PDF | 🟡 `report.ts` + portal/report; PDF/branding to verify |
| §19 | RMM deployment | 🟡 install scripts ✅; signed/enrollment hardening partial |
| §20 | DB design | 🟡 most entities ✅; no mcp_servers/attack_path/subscriptions; RLS unverified |
| §21 | Versioned `/api/v1/*` | 🟡 functional API exists, not under `/api/v1` namespace |
| §22 | Demo mode | 🟡 `sample-data.ts` exists; dedicated gated demo to verify |
| §23 | Alerts/notifications | ✅ `alerts.ts` + table + cron mail |
| §24 | Privacy | ✅ by-default offline/redaction |
| §25 | Testing | 🟡 broad unit tests; cross-tenant/security suite to expand |

---

## 9. Build Log

Append a dated entry whenever you build or change something. Template:

```
### YYYY-MM-DD — <short title>
- What changed: <files/dirs>
- How it works: <1-3 lines>
- Status moved: <X ⬜→🟡 / 🟡→✅>
- Branch/PR: <ref>
- Follow-ups: <next steps>
```

### 2026-10-28 — Architecture doc created
- What changed: added `ARCHITECTURE.md` (this file).
- How it works: snapshot of the tree mapped against `PLANANDVISION.MD`; grounded in `scanner/` and `console/` as they stand on `fix/deploy-messaging-and-docs`.
- Status moved: n/a (baseline).
- Branch/PR: `fix/deploy-messaging-and-docs` (uncommitted).
- Follow-ups: verify RLS + `/check` redaction + report PDF; decide whether lockfile (§13) or attack-path graph (§14) is the next build.
