# Zinloop Security — Complete Product Development Specification

## 1. Product Overview

**Product:** Zinloop Security  
**Website:** https://zinloop.com  
**Repository:** https://github.com/atulpokharel-gp/zinloop-zipax  
**Primary customers:** Managed Service Providers (MSPs) serving small and mid-sized businesses  
**Secondary users:** Internal IT teams, security administrators, developers, and compliance teams

### Mission

Build a privacy-first security platform that discovers, monitors, evaluates, and helps remediate security risks introduced by AI coding assistants, autonomous agents, MCP servers, and their connections to company systems.

As employees adopt Claude, Cursor, ChatGPT, Codex, GitHub Copilot, VS Code extensions, and other AI applications, organizations lose visibility into which AI tools are installed, which MCP servers they connect to, what permissions those servers possess, and which credentials may be exposed.

Zinloop Security must solve this by providing:

1. An open-source, cross-platform endpoint scanner.
2. A centralized, multi-tenant MSP security console.
3. A browser-based public MCP security grader.
4. Continuous configuration monitoring and drift detection.
5. Credential exposure detection and secure remediation.
6. MCP server inventory and dependency risk analysis.
7. An interactive attack-path visualization system.
8. Microsoft 365 and Entra ID security integration.
9. MSP deployment and automation tools.
10. Executive reporting, audit trails, and customer-facing reports.

**Core positioning:**

"Know what your AI agents can access. Find the risks. Fix them before they become incidents."

### Existing codebase requirement

Start by cloning and thoroughly inspecting the existing repository.

Do not replace working functionality unnecessarily. Identify existing modules, reuse their APIs and database models where appropriate, and improve the current implementation through incremental refactoring.

Preserve existing scanner capabilities, authentication, tenant isolation, Microsoft 365 integration, remediation functions, reporting, Zipax privacy boundaries, and deployment automation.

Create separate feature branches and pull requests. Do not push directly to main.

---

# 2. Product Architecture

Build Zinloop as three connected layers.

### Layer A — Endpoint Security Scanner

A lightweight Go application that runs on Windows, macOS, and Linux.

Responsibilities:

- Discover supported AI applications and MCP configurations.
- Parse local and project-level connector configurations.
- Detect exposed secrets and unsafe settings.
- Identify suspicious MCP packages and dependencies.
- Detect potential prompt injection and tool poisoning.
- Assess combinations of permissions that create attack paths.
- Generate a privacy-safe security report.
- Create and verify MCP security lockfiles.
- Move supported plaintext credentials into OS password stores.
- Safely preview, apply, and reverse local configuration changes.
- Run continuously when explicitly installed as a managed service.
- Upload redacted findings only when authorized.

The scanner must run entirely offline by default.

### Layer B — MSP Security Management Platform

A centralized SaaS console that lets an MSP monitor multiple customer environments from a single account.

Responsibilities:

- MSP account management.
- Multi-client organization management.
- User roles and authentication.
- Endpoint inventory.
- AI application and MCP server inventories.
- Security findings and prioritization.
- Credential-remediation tracking.
- Attack-path analysis.
- Microsoft 365 security checks.
- Policy management.
- Automated alerts.
- Audit logs.
- Printable client reports.
- Billing and subscription management.

### Layer C — Public Security Tools

A collection of free, privacy-preserving tools that attract developers, MSP operators, and security teams.

Initially:

- Public MCP configuration grader.
- Local scanner download.
- Security documentation.
- MCP hardening guides.
- Interactive demonstrations.
- Public GitHub repository and release links.

The public tools must be useful without requiring registration.

---

# 3. Technology Stack

Reuse the existing technology where possible.

| Component | Preferred technology |
|---|---|
| Marketing website | Next.js, React, TypeScript |
| MSP dashboard | Next.js App Router |
| Scanner | Go |
| Database | PostgreSQL |
| Managed PostgreSQL | Neon |
| Hosting | Vercel |
| Authentication | Secure server-side sessions, TOTP MFA |
| Enterprise authentication | Microsoft Entra ID / OIDC, later |
| Charts | Lightweight React charting library |
| Attack graph | React Flow or equivalent |
| Reports | Server-rendered printable HTML and PDF export |
| Endpoint installation | PowerShell, Bash, RMM scripts |
| CI/CD | GitHub Actions |
| Security scan output | Versioned JSON and optional SARIF |
| Monitoring | Privacy-safe structured application logs |

All dependencies must be evaluated for security, maintenance, and licensing suitability before adoption.

Prioritize maintainability and a small dependency footprint.

---

# 4. Visual Identity and Design System

Create a modern cybersecurity interface that feels premium, professional, and operational.

### Brand colors

- Midnight background: `#06080F`
- Navy surfaces: `#11162A`
- Cobalt blue: `#3B5BFF`
- Electric lime: `#C9FF3B`
- Primary text: `#EEF1FB`
- Muted text: `#9AA3C2`
- Critical findings: red
- Warnings: amber
- Verified healthy states: green

### Logo

Use the Zinloop Z-shaped eye logo already developed.

The Z symbolizes the brand, and the eye represents continuous AI-agent visibility.

Create an optimized SVG variant with a subtle pupil-following animation.

Important:

- The animation must be lightweight.
- Follow pointer movement only where appropriate.
- Respect reduced-motion accessibility preferences.
- Provide a static fallback.
- Do not cause unnecessary CPU usage.
- Support light and dark backgrounds.

### UI principles

- Dark-first premium visual identity.
- Light mode available for the operations dashboard.
- Compact, information-rich layouts.
- Left navigation sidebar for the console.
- Simple navigation on public marketing pages.
- Responsive desktop, tablet, and mobile designs.
- Accessible forms and keyboard navigation.
- Search, filtering, and sorting throughout the console.
- Clear distinction between verified risks, potential risks, and incomplete scans.
- Every finding must have an understandable explanation and recommended action.

Avoid visual clutter, excessive animation, unnecessary gradients, and decorative charts.

The interface should resemble a mature security operations product, not a generic AI chatbot.

---

# 5. Public Marketing Website

Create or refactor the public website at `zinloop.com`.

### Main pages

**Homepage — `/`**

Present a clear value proposition.

Hero headline:

"Your employees connected AI to company data. Do you know what it can access?"

Subheadline:

"Zinloop helps MSPs discover risky AI agents, exposed credentials, and unsafe MCP connections across their customers' devices."

Primary actions:

- Scan an MCP config for free.
- Download the scanner.
- Start a free MSP account.
- Request a demo.

Include a visual preview of the MSP dashboard.

Explain the workflow:

Discover → Assess → Fix → Monitor → Report.

**Product — `/product`**

Explain endpoint discovery, continuous scanning, agent inventory, credential remediation, and centralized monitoring.

**MCP Security — `/mcp-security`**

Explain MCP threats, tool poisoning, permissions, credentials, attack paths, and configuration drift.

**For MSPs — `/msps`**

Explain multi-tenant management, RMM deployment, client reporting, and recurring managed security services.

**Download — `/download`**

Provide signed or checksum-verifiable scanner releases for Windows, macOS, and Linux.

**Pricing — `/pricing`**

Support a free scanner and an MSP subscription based on managed devices.

Initial pricing hypothesis:

- Free local scanner.
- Free configuration grader.
- Free first MSP assessment.
- Managed endpoint subscription starting at $2/device/month.
- $99/month MSP minimum, subject to validation.

**Documentation — `/docs`**

Include installation, scanner commands, security rule explanations, privacy, supported applications, deployment guides, and troubleshooting.

**Security and Privacy — `/security` and `/privacy`**

Explain exactly what Zinloop scans, stores, transmits, and never collects.

**Public grader — `/check`**

The free MCP configuration security assessment tool.

---

# 6. Public MCP Security Grader

Build a free, client-side MCP security grader at:

`https://zinloop.com/check`

### User experience

The page should contain:

- A large syntax-highlighted configuration editor.
- Paste and file-import options.
- Example configurations.
- A security analysis action.
- A score visualization.
- Findings grouped by severity.
- A server inventory.
- Fix recommendations.
- Copyable corrected configuration suggestions.
- A safe sharing function.

### Assessment features

Detect:

- Plaintext API keys.
- Embedded authentication tokens.
- Insecure remote URLs.
- Unrestricted filesystem access.
- Dangerous shell execution permissions.
- Unpinned packages.
- Suspicious package names.
- Untrusted package sources.
- Broad OAuth scopes.
- Unsafe environment-variable configurations.
- Potential tool poisoning.
- Suspicious Unicode or hidden instructions.
- Combined MCP capabilities that may create attack paths.

Each result should include:

- Rule identifier.
- Severity.
- Confidence or verification status.
- Affected configuration field.
- Explanation.
- Potential impact.
- Recommended remediation.

### Privacy requirements

All pasted configuration analysis must run inside the browser.

Do not upload pasted configuration contents, secret values, or raw credentials to the Zinloop backend.

Do not send the pasted content to analytics, error trackers, AI APIs, or third-party services.

Redact detected secrets from rendered findings and exports.

### Shareable grades

Generate a safe shareable security summary.

The shared version should contain only explicitly selected, sanitized information, such as:

- Overall grade.
- Finding categories.
- Severity totals.
- Assessment date.
- Scanner/rules version.

Never place raw configuration or secrets in a URL.

Use a local-only shareable summary or an explicitly authorized server-side publication flow.

Sharing must be optional.

---

# 7. MSP Authentication and Account Management

Support independent MSP organizations with strict tenant isolation.

### Authentication features

- MSP self-service signup.
- Email verification.
- Secure password authentication.
- Password reset.
- TOTP-based two-factor authentication.
- MFA recovery codes.
- Session expiration.
- Session revocation.
- Recent login history.
- Login rate limiting.
- Protection against credential-stuffing attempts.
- CSRF protection where applicable.
- Secure, HTTP-only session cookies.

### User roles

**MSP Owner**

Full organization management, billing, clients, access controls, and security policies.

**MSP Admin**

Manage clients, devices, integrations, findings, and team members.

**Security Analyst**

Investigate findings, review attack paths, manage approved workflows, and generate reports.

**Technician**

View assigned customers and perform permitted remediation actions.

**Read-only Auditor**

View assigned reports and evidence without modifying security settings.

### Team management

Allow administrators to:

- Invite teammates by email.
- Assign roles.
- Restrict customer access.
- Revoke invitations.
- Disable user accounts.
- Review team activity.
- Require MFA for privileged accounts.

All sensitive operations must be recorded in an audit log.

---

# 8. MSP Dashboard

Create a comprehensive security management console at `/app`.

Use a left sidebar.

### Suggested navigation

**Overview**

- Dashboard
- Security findings
- Attack paths
- Activity

**Inventory**

- Clients
- Devices
- AI applications
- MCP servers
- Credentials
- People

**Protection**

- Remediation
- Policies
- Configuration drift
- Microsoft 365
- Alerts

**Management**

- Reports
- Team
- Integrations
- Billing
- Settings

### Main dashboard layout

Top navigation:

- MSP workspace selector.
- Global search.
- Client selector.
- Notification center.
- User account menu.

### Security summary cards

Display:

- Total managed clients.
- Total inventoried devices.
- Devices with recent successful scans.
- Active AI applications.
- Detected MCP server instances.
- High-severity open findings.
- Exposed credential findings.
- Suspected attack paths.
- New configuration changes.
- Overdue remediations.

### Dashboard visualizations

**Risk trend**

Show security findings over 7, 30, and 90 days.

**Client risk table**

Columns:

- Client name.
- Devices.
- Scan coverage.
- AI agents detected.
- MCP servers.
- Critical/high findings.
- Risk trend.
- Last scan.
- Actions.

**Action queue**

Prioritize verified, actionable issues.

Example:

"Plaintext GitHub token found in Claude Desktop configuration on device DEV-042."

Include a direct investigation link.

**Credential protection progress**

Show:

- Exposed plaintext credentials.
- Credentials moved into secure storage.
- Rotation still required.
- Confirmed revoked or replaced credentials.

**Latest events**

Show new servers, changed permissions, failed scans, drift, and completed remediations.

All charts must support real data, proper empty states, and accessible alternatives.

---

# 9. Client Management

Each MSP must be able to create and manage multiple client organizations.

### Client details

- Organization name.
- Primary contact.
- Industry.
- Estimated device count.
- Managed devices.
- Microsoft 365 tenant information.
- Assigned technicians.
- Scan status.
- Risk findings.
- Security policies.
- Report history.

### Client-specific dashboard

Include the following tabs:

- Overview
- Devices
- Agents
- MCP Servers
- Findings
- Attack Paths
- Credentials
- Microsoft 365
- Policies
- Reports
- Activity

An MSP technician must never be able to access another MSP's customer data.

Apply tenant authorization at the API, service, and database layers.

---

# 10. Cross-Platform Endpoint Scanner

Build on the existing Go scanner.

Executable:

`zinloop`

Support:

- Windows x64 and, where feasible, ARM64.
- macOS Intel and Apple Silicon.
- Linux x64 and ARM64.

The default command should perform a read-only, offline scan.

### Discovery coverage

Support documented configuration locations and formats for:

- Claude Desktop.
- Claude Code.
- Cursor.
- VS Code.
- Windsurf.
- OpenAI Codex.
- GitHub Copilot environments exposing accessible MCP configuration.
- Additional supported MCP clients through an extensible adapter system.

For ChatGPT and other hosted applications, only claim endpoint coverage for configurations actually accessible to the scanner.

Support both global and project-specific configurations.

The scanner must discover:

- Application name.
- Configuration location.
- MCP server definition.
- Server command or endpoint.
- Transport type.
- Package name and version.
- Environment-variable names.
- Permission configuration.
- Associated MCP tools when safely observable.
- Relevant local skill or plugin manifests.

Do not read unrelated conversation histories or code contents unless an explicitly enabled feature requires it.

### Scanner commands

Provide a clean CLI interface:

```bash
zinloop scan
zinloop scan --json
zinloop scan --out scan.json
zinloop scan --project .
zinloop scan --fail-on high
zinloop scan --all-users
zinloop fix-secrets
zinloop fix-secrets --apply
zinloop revert
zinloop rotate --list
zinloop lock create
zinloop lock verify
zinloop graph --format html
zinloop status
zinloop version
```

These are target commands. Preserve backward compatibility with existing CLI flags where possible.

---

# 11. Security Detection Engine

Build a modular, versioned detection system.

### Detection categories

**Credential exposure**

Detect hardcoded API keys, passwords, access tokens, secrets embedded in URLs, and potentially sensitive command arguments.

**Excessive permissions**

Identify broad filesystem access, shell execution, privileged containers, unrestricted scopes, and dangerous permissions.

**MCP tool poisoning**

Inspect suspicious instructions in available descriptions, manifests, and metadata.

Detect hidden Unicode instructions, unexpected role instructions, and attempts to redirect agent behavior.

Static detection must be clearly distinguished from confirmed malicious behavior.

**Package security**

Detect:

- Unpinned package versions.
- Direct execution from unfamiliar sources.
- Suspicious registry endpoints.
- Typosquatting indicators.
- Potential package-name impersonation.
- Packages matching locally available vulnerability advisories.
- Unexpected package-source or integrity changes.

Offline vulnerability results must display the advisory dataset version and must not claim to be current without an updated local database.

**Network exposure**

Detect unencrypted remote transports, suspicious endpoints, risky bind addresses, and authentication weaknesses visible in configuration.

**Dangerous combinations**

Identify combinations such as:

- Broad filesystem access plus remote data-transfer capability.
- Shell access combined with access to credential-bearing resources.
- Untrusted MCP sources with high-privilege local execution.
- Sensitive SaaS scopes combined with suspicious remote destinations.

Present these as suspected attack paths unless real exploitability has been independently demonstrated.

### Finding model

Every finding must have:

- Unique ID.
- Rule ID.
- Severity.
- Confidence.
- Detection method.
- Evidence summary.
- Source application.
- Affected server.
- Affected device.
- First detected time.
- Last detected time.
- Remediation instructions.
- Current workflow status.

Support statuses including:

Open, Investigating, Remediated, Accepted Risk, False Positive, and Reopened.

---

# 12. Credential Security and Remediation

The scanner must detect plaintext credentials without disclosing their values to the MSP console.

### Supported password stores

- Windows Credential Manager.
- macOS Keychain.
- Linux Secret Service, where available.

### Remediation process

1. Identify supported plaintext credentials.
2. Show a preview of proposed changes.
3. Request authorization before making changes.
4. Store the secret in the OS password store.
5. Verify that it can be retrieved.
6. Create a permission-restricted backup.
7. Update the compatible connector configuration.
8. Validate the rewritten configuration.
9. Support safe rollback.
10. Track any required credential rotation.

### Important safeguards

- No automatic destructive changes during scanning.
- No plaintext secrets in console uploads.
- No key values in diagnostic logs.
- Rollback must preserve recoverability.
- Credential rotation must be treated separately from local keychain migration.
- Never claim a credential is revoked until the provider confirms revocation.
- Do not automatically execute third-party MCP code during ordinary security scans.

Provide a clear distinction between:

**Move key to secure storage**, **rotate key**, **revoke provider access**, and **disable MCP server**.

---

# 13. MCP Lockfile and Drift Detection

Add a deterministic, committable security lockfile.

Suggested name:

`zinloop.lock.json`

### Lockfile contents

Store normalized, non-secret information:

- Schema version.
- Server identity.
- Application and configuration scope.
- Package name.
- Pinned version.
- Source registry or provenance.
- Transport.
- Sanitized endpoint identity.
- Relevant permission declarations.
- Tool-name inventory.
- Tool-definition fingerprints when available.
- Security-policy version.
- Creation timestamp.

Never store secrets, raw prompts, or private session data.

### Commands

```bash
zinloop lock create
zinloop lock verify
zinloop lock diff
zinloop lock update
```

### Drift detection

Identify:

- Added MCP servers.
- Removed servers.
- Changed packages.
- Changed versions.
- Modified command arguments.
- Changed server endpoints.
- Expanded permissions.
- New or removed tool definitions.
- Changed tool schemas or descriptions when verified fingerprints are available.

Tool probing must remain optional and isolated because starting an MCP server may execute third-party code.

### CI integration

Support GitHub Actions and other CI systems.

Requirements:

- Exit 0 for successful checks.
- Exit 1 for scanner execution or configuration errors.
- Exit 2 for policy violations or lockfile drift.
- Additional distinct codes for upload or infrastructure failures.

Return human-readable and JSON results, with optional SARIF output.

Support configurable severity thresholds and policy exceptions.

Incomplete scans must never silently pass as clean.

---

# 14. Interactive Attack-Path Graph

Build a graph-based security visualization.

### Graph nodes

- Device.
- Employee.
- AI application.
- MCP server.
- MCP tool.
- Local resource.
- SaaS application.
- Credential reference.
- Permission.
- External endpoint.

### Graph edges

- Installed on.
- Configured by.
- Connects to.
- Reads.
- Writes.
- Executes.
- Authenticates with.
- May transfer data to.

Distinguish observed relationships from inferred relationships.

### User interface

Allow operators to:

- Zoom and pan.
- Select nodes.
- Inspect associated findings.
- Filter by risk.
- Filter by client or device.
- View suspected attack paths.
- Highlight high-impact connections.
- Compare graph snapshots.
- Export a sanitized graph.

### Remediation recommendations

For each suspected attack path, show:

- Which permissions contribute to risk.
- Which MCP server or connection is involved.
- What evidence supports the assessment.
- Recommended changes.
- Potential operational impact.
- Whether a fix can be performed automatically.

Avoid recommending server removal purely because a server has many permissions. Consider actual business necessity and available evidence.

Provide an optional offline browser-based graph viewer for locally generated scan reports.

---

# 15. Continuous Monitoring

Support an optional managed endpoint service.

### Service responsibilities

- Run scheduled scans.
- Detect changes to supported configuration files.
- Compare results with previous snapshots.
- Detect new MCP servers.
- Detect permission expansion.
- Identify previously unseen credentials.
- Detect lockfile drift.
- Track scanner health.
- Upload redacted results when MSP management is explicitly configured.

### Requirements

- No telemetry in standalone offline mode.
- No unnecessary network activity.
- Configurable intervals.
- Scan retries with backoff.
- Local caching of authorized reports during outages.
- Safe file permissions.
- Minimal resource consumption.
- Signed or integrity-verified updates.
- Clear uninstall instructions.

Avoid duplicate scanning when an RMM already schedules the endpoint scanner.

---

# 16. Microsoft 365 Integration

Allow MSPs to connect customer Microsoft 365 tenants through authorized Microsoft Graph access.

### Security checks

Assess supported information related to:

- Enterprise applications.
- OAuth application grants.
- High-privilege permissions.
- Tenant-wide administrative consent.
- Suspicious or unexpected applications.
- Privileged access configuration.
- Selected authentication and MFA policy indicators.
- Application credentials and expirations where API permissions permit.
- Relevant consent or permission changes.

### Authorization requirements

- Prefer least-privilege, read-only Graph permissions.
- Obtain appropriate customer administrator consent.
- Separate assessment permissions from remediation permissions.
- Never request broad write permissions solely to perform an assessment.
- Store integration credentials securely.
- Allow each customer integration to be disconnected.

### Revocation workflow

For supported actions:

1. Show the selected grant or application.
2. Explain what access will be removed.
3. Require an authorized administrator.
4. Require confirmation.
5. Perform the provider-side action.
6. Verify the result through Microsoft Graph.
7. Record the action in the audit log.

Do not present revocation as successful merely because an API request was submitted.

---

# 17. Security Findings and Remediation Console

Create a centralized remediation workspace.

### Findings table

Columns:

- Severity.
- Finding.
- Client.
- Device.
- AI application.
- MCP server.
- First detected.
- Last detected.
- Owner.
- Status.

Support search and filtering.

### Finding detail view

Show:

- Summary.
- Technical explanation.
- Evidence.
- Affected resources.
- Potential impact.
- Detection confidence.
- Suggested remediation.
- Associated attack paths.
- Timeline.
- Audit history.

### Remediation workflow

Allow technicians to:

- Assign a finding.
- Add notes.
- Create remediation tasks.
- Mark false positives.
- Accept documented risks.
- Apply supported local fixes through an authorized endpoint workflow.
- Request provider-side credential revocation.
- Verify remediation through a follow-up scan.

Dangerous changes require appropriate permissions and confirmation.

---

# 18. Reporting and Compliance

Build printable and downloadable client security reports.

### Report types

- Executive security overview.
- Device security assessment.
- AI-agent inventory.
- MCP risk assessment.
- Credential exposure report.
- Monthly MSP security report.
- Remediation progress report.
- Configuration drift report.
- Microsoft 365 security summary.

### Executive report structure

**Cover**

Client name, reporting period, provider name, and report generation date.

**Executive summary**

Explain the overall security situation in plain language.

**Security metrics**

Include scan coverage, findings, exposed credentials, and remediation progress.

**Major risks**

Prioritized descriptions with evidence and business impact.

**Recommended actions**

Specific, realistic remediation steps.

**Progress**

Changes since the previous assessment.

**Methodology**

Scanner version, policy version, sources checked, scan limitations, and timestamps.

### Output requirements

- Printable HTML.
- Downloadable PDF.
- Optional MSP logo.
- Optional customer branding.
- Appropriate page breaks.
- Clear severity indicators.
- No raw secrets.
- No fabricated compliance certification claims.

---

# 19. MSP Deployment and RMM Integration

Provide supported installation methods for each operating system.

### Windows

PowerShell installer and Windows-compatible executable.

### macOS

Shell installer supporting Intel and Apple Silicon.

### Linux

Shell installer supporting common distributions and available service managers.

### RMM deployment

Supply scripts compatible with common MSP remote-management workflows.

The scripts should:

- Download the appropriate release.
- Verify checksums and signatures when available.
- Install with least required privileges.
- Configure organization/device enrollment.
- Store upload tokens securely.
- Perform the initial scan.
- Register the scheduled task or service.
- Report installation success or failure.
- Support noninteractive upgrades.
- Support clean uninstall.

Never embed permanent MSP administrative credentials in installation scripts.

Use client-scoped, revocable enrollment credentials and rotate them as needed.

---

# 20. MSP Database Design

Use PostgreSQL with a maintainable relational schema.

Core entities should include:

- MSP organizations.
- Users.
- Team memberships.
- Roles.
- Invitations.
- Sessions and MFA credentials.
- Client organizations.
- Devices.
- Scanner installations.
- Scan runs.
- AI applications.
- MCP server definitions.
- MCP server instances.
- MCP tools.
- Security findings.
- Credentials metadata.
- Remediation actions.
- Security policies.
- Lockfile snapshots.
- Drift events.
- Attack-path nodes and relationships.
- Microsoft 365 integrations.
- Alerts.
- Audit events.
- Reports.
- Subscription records.

### Isolation requirements

Every customer-owned record must be associated with the correct organization and client.

Enforce PostgreSQL row-level security and verify authorization in server-side operations.

Test cross-tenant isolation, including attempts to access records using guessed or modified identifiers.

Use additive database migrations whenever possible.

Do not destroy existing production data while refactoring.

---

# 21. API Design

Create versioned, authenticated APIs for endpoint and console operations.

Example API groups:

```text
/api/v1/auth
/api/v1/organizations
/api/v1/team
/api/v1/clients
/api/v1/devices
/api/v1/scans
/api/v1/agents
/api/v1/mcp-servers
/api/v1/findings
/api/v1/remediations
/api/v1/credentials
/api/v1/attack-paths
/api/v1/lockfiles
/api/v1/policies
/api/v1/microsoft365
/api/v1/reports
/api/v1/alerts
/api/v1/audit
```

Implement:

- Strict input validation.
- Tenant-aware authorization.
- Token scoping.
- Rate limiting.
- Pagination.
- Stable identifiers.
- Structured errors.
- API versioning.
- Audit logging for state changes.

Endpoint upload tokens must be restricted to the designated customer or device and the minimum necessary actions.

---

# 22. Demo Mode

Provide a fully usable demonstration mode without a database.

The demo should allow potential MSP customers to explore:

- Dashboard.
- Example clients.
- Devices.
- MCP inventories.
- Findings.
- Attack graph.
- Credential remediation explanations.
- Microsoft 365 security results.
- Report previews.

Use realistic but entirely synthetic data.

All demo pages must clearly identify the environment as a demonstration.

Disable real destructive actions, provider revocation, and accidental outbound uploads.

The demo should be deployable separately from production or explicitly gated behind a safe configuration.

---

# 23. Alerts and Notifications

Implement configurable notifications for:

- Newly discovered high-risk MCP servers.
- Plaintext credential findings.
- New high-privilege permissions.
- Configuration drift.
- Dangerous package changes.
- Failed endpoint scans.
- Stale endpoint coverage.
- Microsoft 365 permission changes.
- Failed remediation attempts.
- Pending credential rotations.

Support:

- In-app notifications.
- Email alerts.
- Webhooks.
- Alert aggregation and deduplication.
- Configurable severity thresholds.
- Customer-specific notification policies.

Avoid flooding MSP technicians with repeated low-confidence findings.

---

# 24. Privacy and Security Requirements

Privacy is a core product feature, not an optional setting.

### Default behaviors

- Local scanner is offline.
- No telemetry.
- No prompt collection.
- No conversation collection.
- No secret-value uploads.
- No automatic execution of MCP servers.
- No automatic destructive remediation.
- No public profile publishing.
- No hidden data sharing.

### Managed deployment

For MSP-managed installations, document exactly which redacted metadata is sent to the console.

Provide configurable data-retention periods, deletion controls, access auditing, and clear ownership boundaries.

### Zipax separation

The existing Zipax developer-profile functionality may share reusable code and authentication infrastructure, but it must not automatically publish company-managed security information.

Developer profile claims and publication require explicit consent.

Security telemetry and public reputation data must remain logically isolated.

---

# 25. Testing and Production Readiness

Build comprehensive automated tests.

### Scanner testing

- Configuration discovery tests.
- Parsing tests.
- Secret-detection tests.
- Redaction tests.
- Prompt-injection heuristic tests.
- Permission-detection tests.
- Package-analysis tests.
- Lockfile drift tests.
- Attack-graph generation tests.
- Credential migration tests.
- Credential rollback tests.
- Windows password-store integration tests.
- macOS Keychain tests.
- Linux Secret Service tests where supported.
- Invalid or malicious configuration tests.

### Console testing

- Signup and login.
- MFA enrollment and verification.
- Invitation workflows.
- RBAC enforcement.
- Tenant isolation.
- Device enrollment.
- Scan uploads.
- Finding lifecycle.
- Report generation.
- Microsoft 365 permission boundaries.
- API authorization.
- Demo mode.

### Security testing

- Sensitive information disclosure.
- Cross-tenant access.
- CSRF and injection vulnerabilities.
- Unsafe file paths and symlinks.
- Malicious MCP configuration payloads.
- Oversized files.
- Unsafe subprocess execution.
- Supply-chain integrity.
- Browser-side grader privacy.
- Backup and recovery.

Use integration tests with a real test PostgreSQL database where appropriate.

---

# 26. Implementation Phases

### Phase 1 — Existing Codebase Audit and Stabilization

- Review the existing repository.
- Inventory working features.
- Identify incomplete modules.
- Review open PRs.
- Confirm scanner and console tests pass.
- Document existing routes and database structures.
- Fix critical security or compatibility problems.

### Phase 2 — Scanner Improvements

- Strengthen MCP discovery.
- Improve detection accuracy.
- Add package and dependency checks.
- Add security lockfile generation.
- Add drift verification.
- Improve structured finding output.
- Add the local attack-graph exporter.

### Phase 3 — Console Refactor

- Implement the unified design system.
- Reorganize dashboard navigation.
- Improve client and device workflows.
- Add richer finding details.
- Add remediation tracking.
- Add attack-path visualization.

### Phase 4 — Public Experience

- Refine the marketing website.
- Improve the browser-only MCP grader.
- Add safer sharing.
- Improve documentation.
- Add polished download and installation flows.

### Phase 5 — MSP Operations

- Complete role-based access controls.
- Complete MFA and team invitations.
- Improve Microsoft 365 checks.
- Add notification policies.
- Improve report generation.
- Harden RMM deployment.

### Phase 6 — Release Validation

- Run cross-platform builds.
- Execute the security test suite.
- Validate tenant isolation.
- Test installation and rollback.
- Test device-to-console reporting.
- Test backup and restore.
- Validate documentation and production configuration.

---

# 27. Definition of Done

The product must satisfy the following end-to-end scenario:

1. An MSP visits zinloop.com.
2. The MSP creates an account.
3. The MSP enrolls in two-factor authentication.
4. The MSP invites a technician.
5. The MSP creates a client organization.
6. The MSP obtains a scoped scanner enrollment token.
7. The scanner is installed on a client laptop.
8. The scanner discovers supported AI-agent configurations.
9. The scanner detects a plaintext credential or risky MCP setting.
10. The scanner generates a redacted local report.
11. The authorized scanner uploads results to the console.
12. The device appears under the correct client.
13. The MSP sees the finding and its supporting evidence.
14. The technician reviews a recommended remediation.
15. The technician performs an authorized, supported fix.
16. A subsequent scan verifies the local remediation.
17. The MSP checks the connected Microsoft 365 tenant.
18. The MSP generates and prints a client security report.
19. A developer independently pastes an MCP configuration into `/check` and receives a browser-only assessment.
20. The developer creates a lockfile and runs drift verification in CI.

All operations must enforce the specified privacy and authorization boundaries.

---

# 28. Engineering Instructions

Act as a senior full-stack engineer, security engineer, product designer, and DevOps architect.

**Do not only generate mockups, placeholder pages, or high-level architecture. Implement functional, tested software based on the existing repository.**

Requirements:

- Inspect existing code before making changes.
- Reuse functional modules.
- Avoid unnecessary rewrites.
- Preserve current public URLs.
- Maintain backward compatibility where practical.
- Use production-quality error handling.
- Never hardcode credentials.
- Keep sensitive data out of logs.
- Implement real authorization checks.
- Use database migrations safely.
- Add automated tests for each major feature.
- Validate cross-platform scanner behavior.
- Document unsupported configurations clearly.
- Never describe an unimplemented feature as complete.
- Use feature branches and reviewable PRs.
- Do not modify production credentials or deploy destructive changes without authorization.

For every implementation phase, provide:

1. Existing functionality reviewed.
2. Files added or modified.
3. Features implemented.
4. Tests executed and results.
5. Security concerns addressed.
6. Remaining limitations.
7. Pull request or commit reference.
8. Next recommended implementation steps.

**Final objective:** Deliver a cohesive, production-oriented Zinloop Security platform where MSPs can discover AI-agent exposure, understand risk, perform safe remediations, monitor changes, and demonstrate security improvements across multiple customer environments—all through one consistent, privacy-first product.
