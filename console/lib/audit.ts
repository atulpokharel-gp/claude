// The audit log: who did what, when, from where. Entries can be added and read
// by the app, never changed or deleted (see migration 004).

import { withTenant } from "./db.ts";

export const AUDIT_ACTIONS = {
  signed_up: "Created the account",
  signed_in: "Signed in",
  sign_in_failed: "Failed sign-in",
  signed_out: "Signed out",
  sessions_ended: "Signed out other devices",
  password_changed: "Changed password",
  mfa_enabled: "Turned on two-factor sign-in",
  mfa_disabled: "Turned off two-factor sign-in",
  require_mfa_changed: "Changed the two-factor rule for the team",
  invite_created: "Invited a teammate",
  invite_revoked: "Cancelled an invite",
  member_joined: "Joined the team",
  member_removed: "Removed a teammate",
  client_created: "Added a client",
  upload_token_created: "Created a laptop upload token",
  upload_token_revoked: "Revoked a laptop upload token",
  m365_connected: "Connected Microsoft 365",
  m365_disconnected: "Disconnected Microsoft 365",
  m365_app_revoked: "Revoked an AI app in Microsoft 365",
  client_login_created: "Invited a client viewer",
  client_login_removed: "Removed a client viewer",
  client_viewer_joined: "Client viewer joined",
  microsoft_linked: "Linked a Microsoft account",
  microsoft_unlinked: "Unlinked a Microsoft account",
  remediation_proposed: "Proposed a remediation",
  remediation_approved: "Approved a remediation",
  remediation_rejected: "Rejected a remediation",
  remediation_cancelled: "Cancelled a remediation",
  remediation_applied: "Applied a remediation",
  remediation_failed: "A remediation failed",
  client_policy_changed: "Changed a client policy",
  report_schedule_set: "Set a report schedule",
  report_schedule_removed: "Removed a report schedule",
  psa_integration_added: "Added a PSA integration",
  psa_integration_removed: "Removed a PSA integration",
  psa_ticket_opened: "Opened a PSA ticket",
  rmm_integration_added: "Added an RMM integration",
  rmm_integration_removed: "Removed an RMM integration",
  rmm_devices_synced: "Synced RMM device inventory",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface Actor {
  userId?: string | null;
  email?: string;
  ip?: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  action: AuditAction;
  label: string;
  target: string;
  detail: Record<string, unknown>;
  ip: string;
}

type Querier = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Adds an entry. Pass `db` to write inside an existing tenant transaction, so
 * the entry is saved only if the change is. Without it, writes on its own.
 */
export async function audit(
  mspId: string,
  actor: Actor,
  action: AuditAction,
  target = "",
  detail: Record<string, unknown> = {},
  db?: Querier,
): Promise<void> {
  const write = (q: Querier) =>
    q.query(
      "insert into audit_log (msp_id, user_id, actor_email, action, target, detail, ip) values ($1, $2, $3, $4, $5, $6, $7)",
      [mspId, actor.userId ?? null, (actor.email ?? "").slice(0, 320), action, target.slice(0, 500), JSON.stringify(detail), (actor.ip ?? "").slice(0, 64)],
    );
  if (db) await write(db);
  else await withTenant(mspId, write);
}

export interface AuditQuery {
  action?: string;
  /** Only entries older than this id, for paging. */
  before?: string;
  limit?: number;
}

export async function listAudit(mspId: string, q: AuditQuery = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 5000);
  const action = q.action && q.action in AUDIT_ACTIONS ? q.action : null;
  const before = q.before && /^\d{1,18}$/.test(q.before) ? q.before : null;
  return withTenant(mspId, async (db) =>
    (
      await db.query<{ id: string; at: Date; actor_email: string; action: AuditAction; target: string; detail: Record<string, unknown>; ip: string }>(
        `select id::text, at, actor_email, action, target, detail, ip from audit_log
         where ($1::text is null or action = $1) and ($2::bigint is null or id < $2)
         order by audit_log.id desc limit $3`,
        [action, before, limit],
      )
    ).rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actorEmail: r.actor_email,
      action: r.action,
      label: AUDIT_ACTIONS[r.action] ?? r.action,
      target: r.target,
      detail: r.detail,
      ip: r.ip,
    })),
  );
}

/** CSV for download. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function auditCsv(entries: AuditEntry[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [["Time (UTC)", "Who", "What", "Target", "IP address", "Details"]];
  for (const e of entries) rows.push([e.at, e.actorEmail, e.label, e.target, e.ip, Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
