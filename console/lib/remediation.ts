// The remediation approval workflow.
//
// Technicians can propose a remediation (revoke an M365 app, rotate a secret);
// an owner or member approves or rejects it; approved work can run on its own
// (auto-apply) or wait for a manual "apply" click. Every step lands in the
// audit log.
//
// The action functions themselves (revokeM365App etc) live in lib/store.ts;
// this module is the policy and queue, so it stays free of their network side
// effects and can be tested with pure assertions.

import { randomUUID } from "node:crypto";
import { audit } from "./audit.ts";
import { withTenant, type Db } from "./db.ts";
import { getPolicy } from "./policies.ts";
import type { Session } from "./auth.ts";

export class RemediationError extends Error {}

export type RemediationStatus = "pending" | "approved" | "rejected" | "applied" | "failed" | "cancelled";

export type RemediationAction = "revoke_m365_app" | "rotate_secret" | "custom";

const ACTIONS: ReadonlySet<RemediationAction> = new Set(["revoke_m365_app", "rotate_secret", "custom"]);

export interface Remediation {
  id: string;
  clientId: string;
  action: RemediationAction;
  payload: Record<string, unknown>;
  summary: string;
  findingKey: string;
  status: RemediationStatus;
  requestedBy: string | null;
  requestedByEmail: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByEmail: string;
  decidedAt: string | null;
  appliedAt: string | null;
  lastError: string;
}

interface Row {
  id: string;
  client_id: string;
  action: RemediationAction;
  payload: Record<string, unknown>;
  summary: string;
  finding_key: string;
  status: RemediationStatus;
  requested_by: string | null;
  requested_by_email: string | null;
  requested_at: Date;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: Date | null;
  applied_at: Date | null;
  last_error: string;
}

function rowToRemediation(r: Row): Remediation {
  return {
    id: r.id,
    clientId: r.client_id,
    action: r.action,
    payload: r.payload ?? {},
    summary: r.summary,
    findingKey: r.finding_key,
    status: r.status,
    requestedBy: r.requested_by,
    requestedByEmail: r.requested_by_email ?? "",
    requestedAt: r.requested_at.toISOString(),
    decidedBy: r.decided_by,
    decidedByEmail: r.decided_by_email ?? "",
    decidedAt: r.decided_at?.toISOString() ?? null,
    appliedAt: r.applied_at?.toISOString() ?? null,
    lastError: r.last_error ?? "",
  };
}

const SELECT = `select r.*, u1.email as requested_by_email, u2.email as decided_by_email
  from remediations r
  left join users u1 on u1.id = r.requested_by
  left join users u2 on u2.id = r.decided_by`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): v is string { return UUID.test(v); }

export interface ProposeInput {
  clientId: string;
  action: RemediationAction;
  payload: Record<string, unknown>;
  summary: string;
  findingKey?: string;
}

/** True when this session's role may propose remediations. */
export function canPropose(role: Session["role"]): boolean {
  return role === "owner" || role === "member" || role === "technician";
}

/** True when this session's role may approve or reject remediations. */
export function canApprove(role: Session["role"]): boolean {
  return role === "owner" || role === "member";
}

/** True when this session's role may apply an approved remediation by hand. */
export function canApply(role: Session["role"]): boolean {
  return role === "owner" || role === "member";
}

/**
 * Add a remediation to the queue. If the caller may both propose and approve,
 * and the client's policy says auto-apply, the row is created with status
 * 'approved' straight away. The caller is still the one who applies it
 * (through applyRemediation) so the network effect is logged separately.
 */
export async function proposeRemediation(session: Session, input: ProposeInput, ip: string | null = null): Promise<Remediation> {
  if (!canPropose(session.role)) throw new RemediationError("Technicians, members and owners can propose a remediation.");
  if (!isUuid(input.clientId)) throw new RemediationError("That client wasn't found.");
  if (!ACTIONS.has(input.action)) throw new RemediationError("That remediation isn't recognized.");
  const summary = String(input.summary ?? "").trim();
  if (!summary || summary.length > 500) throw new RemediationError("Summary must be 1 to 500 characters.");
  const findingKey = String(input.findingKey ?? "").slice(0, 600);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};

  const policy = await getPolicy(session.mspId, input.clientId);
  const autoApprove = canApprove(session.role) && policy.autoApplyApproved;
  const id = randomUUID();

  return withTenant(session.mspId, async (db) => {
    try {
      const insert = await db.query<Row>(
        `insert into remediations (id, msp_id, client_id, action, payload, summary, finding_key, status,
            requested_by, requested_at, decided_by, decided_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now(), $10, $11)
         returning *`,
        [
          id, session.mspId, input.clientId, input.action, JSON.stringify(payload), summary, findingKey,
          autoApprove ? "approved" : "pending",
          session.userId,
          autoApprove ? session.userId : null,
          autoApprove ? new Date() : null,
        ],
      );
      const row = insert.rows[0];
      await audit(session.mspId, { userId: session.userId, email: session.email, ip },
        autoApprove ? "remediation_approved" : "remediation_proposed",
        summary, { remediationId: id, action: input.action, clientId: input.clientId }, db);
      // Re-read with the user emails joined, for a consistent return shape.
      return rowToRemediation({ ...row, requested_by_email: session.email, decided_by_email: autoApprove ? session.email : null });
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new RemediationError("A pending remediation for this already exists.");
      }
      throw err;
    }
  });
}

export async function approveRemediation(session: Session, remediationId: string, ip: string | null = null): Promise<Remediation> {
  if (!canApprove(session.role)) throw new RemediationError("Only an owner or member can approve a remediation.");
  if (!isUuid(remediationId)) throw new RemediationError("That remediation wasn't found.");
  return withTenant(session.mspId, async (db) => {
    const res = await db.query<Row>(
      `update remediations set status = 'approved', decided_by = $2, decided_at = now()
       where id = $1 and status = 'pending' returning *`,
      [remediationId, session.userId],
    );
    if (res.rowCount === 0) throw new RemediationError("This remediation isn't pending any more.");
    const row = res.rows[0];
    await audit(session.mspId, { userId: session.userId, email: session.email, ip },
      "remediation_approved", row.summary, { remediationId, action: row.action, clientId: row.client_id }, db);
    return decorate(db, row);
  });
}

export async function rejectRemediation(session: Session, remediationId: string, ip: string | null = null): Promise<Remediation> {
  if (!canApprove(session.role)) throw new RemediationError("Only an owner or member can reject a remediation.");
  if (!isUuid(remediationId)) throw new RemediationError("That remediation wasn't found.");
  return withTenant(session.mspId, async (db) => {
    const res = await db.query<Row>(
      `update remediations set status = 'rejected', decided_by = $2, decided_at = now()
       where id = $1 and status = 'pending' returning *`,
      [remediationId, session.userId],
    );
    if (res.rowCount === 0) throw new RemediationError("This remediation isn't pending any more.");
    const row = res.rows[0];
    await audit(session.mspId, { userId: session.userId, email: session.email, ip },
      "remediation_rejected", row.summary, { remediationId, action: row.action, clientId: row.client_id }, db);
    return decorate(db, row);
  });
}

export async function cancelRemediation(session: Session, remediationId: string, ip: string | null = null): Promise<Remediation> {
  if (!isUuid(remediationId)) throw new RemediationError("That remediation wasn't found.");
  return withTenant(session.mspId, async (db) => {
    const row = (await db.query<Row>("select * from remediations where id = $1", [remediationId])).rows[0];
    if (!row) throw new RemediationError("That remediation wasn't found.");
    if (row.status !== "pending") throw new RemediationError("Only pending remediations can be cancelled.");
    // A technician may only cancel their own; owners/members may cancel any.
    if (!canApprove(session.role) && row.requested_by !== session.userId) {
      throw new RemediationError("You can only cancel remediations you requested.");
    }
    const res = await db.query<Row>(
      `update remediations set status = 'cancelled', decided_by = $2, decided_at = now()
       where id = $1 and status = 'pending' returning *`,
      [remediationId, session.userId],
    );
    const updated = res.rows[0];
    await audit(session.mspId, { userId: session.userId, email: session.email, ip },
      "remediation_cancelled", updated.summary, { remediationId, action: updated.action, clientId: updated.client_id }, db);
    return decorate(db, updated);
  });
}

/**
 * Mark an approved remediation as applied. The caller runs the real action
 * (store.revokeM365App etc) itself; this just records the outcome and keeps
 * the queue consistent.
 */
export async function markApplied(mspId: string, remediationId: string, actor: { userId: string; email: string; ip?: string | null }): Promise<Remediation> {
  if (!isUuid(remediationId)) throw new RemediationError("That remediation wasn't found.");
  return withTenant(mspId, async (db) => {
    const res = await db.query<Row>(
      `update remediations set status = 'applied', applied_at = now(), last_error = ''
       where id = $1 and status = 'approved' returning *`,
      [remediationId],
    );
    if (res.rowCount === 0) throw new RemediationError("This remediation isn't approved any more.");
    const row = res.rows[0];
    await audit(mspId, actor, "remediation_applied", row.summary,
      { remediationId, action: row.action, clientId: row.client_id }, db);
    return decorate(db, row);
  });
}

export async function markFailed(mspId: string, remediationId: string, error: string, actor: { userId?: string | null; email?: string; ip?: string | null }): Promise<void> {
  if (!isUuid(remediationId)) return;
  await withTenant(mspId, async (db) => {
    const res = await db.query<Row>(
      `update remediations set status = 'failed', last_error = $2 where id = $1 returning *`,
      [remediationId, String(error ?? "").slice(0, 500)],
    );
    const row = res.rows[0];
    if (!row) return;
    await audit(mspId, actor, "remediation_failed", row.summary,
      { remediationId, action: row.action, clientId: row.client_id, error: row.last_error }, db);
  });
}

export interface ListFilter {
  status?: RemediationStatus;
  clientId?: string;
  limit?: number;
}

export async function listRemediations(mspId: string, filter: ListFilter = {}): Promise<Remediation[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const status = filter.status && ["pending", "approved", "rejected", "applied", "failed", "cancelled"].includes(filter.status) ? filter.status : null;
  const clientId = filter.clientId && isUuid(filter.clientId) ? filter.clientId : null;
  return withTenant(mspId, async (db) =>
    (
      await db.query<Row>(
        `${SELECT}
         where ($1::text is null or r.status = $1)
           and ($2::uuid is null or r.client_id = $2)
         order by r.requested_at desc limit $3`,
        [status, clientId, limit],
      )
    ).rows.map(rowToRemediation),
  );
}

export async function getRemediation(mspId: string, remediationId: string): Promise<Remediation | null> {
  if (!isUuid(remediationId)) return null;
  return withTenant(mspId, async (db) => {
    const row = (await db.query<Row>(`${SELECT} where r.id = $1`, [remediationId])).rows[0];
    return row ? rowToRemediation(row) : null;
  });
}

async function decorate(db: Db, row: Row): Promise<Remediation> {
  const emails = (
    await db.query<{ id: string; email: string }>("select id, email from users where id = any($1)",
      [[row.requested_by, row.decided_by].filter((x): x is string => !!x)])
  ).rows;
  const byId = new Map(emails.map((u) => [u.id, u.email]));
  return rowToRemediation({
    ...row,
    requested_by_email: row.requested_by ? byId.get(row.requested_by) ?? "" : null,
    decided_by_email: row.decided_by ? byId.get(row.decided_by) ?? "" : null,
  });
}
