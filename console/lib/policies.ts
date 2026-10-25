// Per-client policies: when to open PSA tickets, whether approved remediations
// run automatically, which publishers are allowed or always blocked, and who
// gets scheduled reports.
//
// The row is created lazily (defaults on read) so adding a client doesn't need
// a second write.

import { withTenant, type Tenant } from "./db.ts";

export type TicketThreshold = "high" | "medium" | "low";

export interface ClientPolicy {
  clientId: string;
  ticketThreshold: TicketThreshold;
  autoApplyApproved: boolean;
  allowedPublishers: string[];
  blockedPublishers: string[];
  reportRecipients: string[];
  psaIntegrationId: string | null;
  psaCompanyId: string;
  rmmIntegrationId: string | null;
  rmmOrganizationId: string;
  updatedAt: string | null;
}

export class PolicyError extends Error {}

interface PolicyDefaults {
  ticketThreshold: TicketThreshold;
  autoApplyApproved: boolean;
  allowedPublishers: string[];
  blockedPublishers: string[];
  reportRecipients: string[];
  psaIntegrationId: string | null;
  psaCompanyId: string;
  rmmIntegrationId: string | null;
  rmmOrganizationId: string;
}

export const DEFAULT_POLICY: PolicyDefaults = {
  ticketThreshold: "high",
  autoApplyApproved: true,
  allowedPublishers: [],
  blockedPublishers: [],
  reportRecipients: [],
  psaIntegrationId: null,
  psaCompanyId: "",
  rmmIntegrationId: null,
  rmmOrganizationId: "",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUuid(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID.test(v);
}

function cleanPublishers(list: unknown): string[] {
  if (!Array.isArray(list)) throw new PolicyError("Publisher list must be an array.");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!v || v.length > 200 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 50) break;
  }
  return out;
}

function cleanEmails(list: unknown): string[] {
  if (!Array.isArray(list)) throw new PolicyError("Report recipients must be an array.");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!EMAIL.test(v) || v.length > 320 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

interface Row {
  client_id: string;
  ticket_threshold: TicketThreshold;
  auto_apply_approved: boolean;
  allowed_publishers: string[];
  blocked_publishers: string[];
  report_recipients: string[];
  psa_integration_id: string | null;
  psa_company_id: string;
  rmm_integration_id: string | null;
  rmm_organization_id: string;
  updated_at: Date;
}

function rowToPolicy(r: Row): ClientPolicy {
  return {
    clientId: r.client_id,
    ticketThreshold: r.ticket_threshold,
    autoApplyApproved: r.auto_apply_approved,
    allowedPublishers: r.allowed_publishers ?? [],
    blockedPublishers: r.blocked_publishers ?? [],
    reportRecipients: r.report_recipients ?? [],
    psaIntegrationId: r.psa_integration_id,
    psaCompanyId: r.psa_company_id ?? "",
    rmmIntegrationId: r.rmm_integration_id,
    rmmOrganizationId: r.rmm_organization_id ?? "",
    updatedAt: r.updated_at?.toISOString() ?? null,
  };
}

export async function getPolicy(tenant: Tenant, clientId: string): Promise<ClientPolicy> {
  if (!isUuid(clientId)) throw new PolicyError("That client wasn't found.");
  return withTenant(tenant, async (db) => {
    const row = (await db.query<Row>("select * from client_policies where client_id = $1", [clientId])).rows[0];
    if (row) return rowToPolicy(row);
    return { clientId, ...DEFAULT_POLICY, updatedAt: null };
  });
}

export interface PolicyUpdate {
  ticketThreshold?: TicketThreshold;
  autoApplyApproved?: boolean;
  allowedPublishers?: string[];
  blockedPublishers?: string[];
  reportRecipients?: string[];
  psaIntegrationId?: string | null;
  psaCompanyId?: string;
  rmmIntegrationId?: string | null;
  rmmOrganizationId?: string;
}

export async function setPolicy(mspId: string, clientId: string, patch: PolicyUpdate): Promise<ClientPolicy> {
  if (!isUuid(clientId)) throw new PolicyError("That client wasn't found.");
  const next = { ...DEFAULT_POLICY };
  if (patch.ticketThreshold !== undefined) {
    if (patch.ticketThreshold !== "high" && patch.ticketThreshold !== "medium" && patch.ticketThreshold !== "low") {
      throw new PolicyError("Pick high, medium or low for the ticket threshold.");
    }
    next.ticketThreshold = patch.ticketThreshold;
  }
  if (patch.autoApplyApproved !== undefined) next.autoApplyApproved = Boolean(patch.autoApplyApproved);
  if (patch.allowedPublishers !== undefined) next.allowedPublishers = cleanPublishers(patch.allowedPublishers);
  if (patch.blockedPublishers !== undefined) next.blockedPublishers = cleanPublishers(patch.blockedPublishers);
  if (patch.reportRecipients !== undefined) next.reportRecipients = cleanEmails(patch.reportRecipients);
  if (patch.psaIntegrationId !== undefined) {
    next.psaIntegrationId = patch.psaIntegrationId === null || patch.psaIntegrationId === "" ? null : isUuid(patch.psaIntegrationId) ? patch.psaIntegrationId : null;
  }
  if (patch.psaCompanyId !== undefined) next.psaCompanyId = String(patch.psaCompanyId ?? "").slice(0, 100);
  if (patch.rmmIntegrationId !== undefined) {
    next.rmmIntegrationId = patch.rmmIntegrationId === null || patch.rmmIntegrationId === "" ? null : isUuid(patch.rmmIntegrationId) ? patch.rmmIntegrationId : null;
  }
  if (patch.rmmOrganizationId !== undefined) next.rmmOrganizationId = String(patch.rmmOrganizationId ?? "").slice(0, 100);

  return withTenant(mspId, async (db) => {
    // Only merge the keys the caller asked to change, so another admin's edit
    // to a different field in the same window isn't lost.
    const cur = (await db.query<Row>("select * from client_policies where client_id = $1", [clientId])).rows[0];
    const merged = cur ? { ...rowToPolicy(cur), ...pickDefined(patch, next) } : { clientId, ...next, updatedAt: null };
    const res = await db.query<Row>(
      `insert into client_policies (client_id, msp_id, ticket_threshold, auto_apply_approved, allowed_publishers,
        blocked_publishers, report_recipients, psa_integration_id, psa_company_id, rmm_integration_id, rmm_organization_id, updated_at)
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() from clients where id = $1
       on conflict (client_id) do update set
         ticket_threshold = excluded.ticket_threshold,
         auto_apply_approved = excluded.auto_apply_approved,
         allowed_publishers = excluded.allowed_publishers,
         blocked_publishers = excluded.blocked_publishers,
         report_recipients = excluded.report_recipients,
         psa_integration_id = excluded.psa_integration_id,
         psa_company_id = excluded.psa_company_id,
         rmm_integration_id = excluded.rmm_integration_id,
         rmm_organization_id = excluded.rmm_organization_id,
         updated_at = now()
       returning *`,
      [
        clientId, mspId, merged.ticketThreshold, merged.autoApplyApproved,
        merged.allowedPublishers, merged.blockedPublishers, merged.reportRecipients,
        merged.psaIntegrationId, merged.psaCompanyId, merged.rmmIntegrationId, merged.rmmOrganizationId,
      ],
    );
    if (res.rowCount === 0) throw new PolicyError("That client wasn't found.");
    return rowToPolicy(res.rows[0]);
  });
}

function pickDefined<T extends object>(src: Partial<T>, cleaned: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(src) as (keyof T)[]) {
    if (src[k] !== undefined) out[k] = cleaned[k];
  }
  return out;
}

/** True when a publisher is on the client's blocklist. Case-insensitive. */
export function publisherBlocked(policy: Pick<ClientPolicy, "blockedPublishers">, publisher: string): boolean {
  const p = publisher.trim().toLowerCase();
  return !!p && policy.blockedPublishers.includes(p);
}

/** True when a publisher is on the client's allowlist. Case-insensitive. */
export function publisherAllowed(policy: Pick<ClientPolicy, "allowedPublishers">, publisher: string): boolean {
  const p = publisher.trim().toLowerCase();
  return !!p && policy.allowedPublishers.includes(p);
}
