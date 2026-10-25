// Where pages get their data: the database when DATABASE_URL is set,
// otherwise the made-up demo data.

import { listClientViewers, type ClientViewers } from "./accounts.ts";
import { hasDatabase } from "./db.ts";
import { clients as sampleClients, demoTrend, getClient as sampleClient, MSP_NAME } from "./sample-data.ts";
import { requireSession, requireViewer } from "./session.ts";
import { getClient, getTrend, listClients, type M365Status, type TrendPoint, type UploadTokenInfo } from "./store.ts";
import type { Client } from "./types.ts";

export interface Overview {
  demo: boolean;
  mspName: string;
  clients: Client[];
}

export async function loadOverview(): Promise<Overview> {
  if (!hasDatabase()) return { demo: true, mspName: MSP_NAME, clients: sampleClients };
  const s = await requireSession();
  return { demo: false, mspName: s.mspName, clients: await listClients(s.mspId) };
}

/** Risk counts per day, summed across clients, for the overview chart. */
export async function loadTrend(days = 90): Promise<TrendPoint[]> {
  if (!hasDatabase()) return demoTrend(days);
  const s = await requireSession();
  return getTrend(s.mspId, days);
}

export interface ClientDetail {
  demo: boolean;
  mspName: string;
  client: Client;
  tokens: UploadTokenInfo[];
  m365: M365Status | null;
  /** Read-only logins for people at the client (none in demo mode). */
  logins: ClientViewers;
  isOwner: boolean;
}

export async function loadClient(id: string): Promise<ClientDetail | undefined> {
  if (!hasDatabase()) {
    const client = sampleClient(id);
    return client && { demo: true, mspName: MSP_NAME, client, tokens: [], m365: null, logins: { viewers: [], invites: [] }, isOwner: false };
  }
  const s = await requireSession();
  const got = await getClient(s.mspId, id);
  if (!got) return undefined;
  return { demo: false, mspName: s.mspName, ...got, logins: await listClientViewers(s.mspId, id), isOwner: s.role === "owner" };
}

export interface ChangeListRow {
  id: string;
  at: string;
  deviceId: string;
  deviceHostname: string;
  scanId: string;
  prevScanId: string | null;
  added: number;
  removed: number;
  changed: number;
  riskUp: number;
  riskDown: number;
  returned: number;
}

export async function loadClientChanges(clientId: string, limit = 100): Promise<ChangeListRow[]> {
  if (!hasDatabase()) return [];
  const s = await requireSession();
  const { withTenant } = await import("./db.ts");
  return withTenant(s.mspId, async (db) => {
    const rows = (
      await db.query<{
        id: string;
        at: Date;
        device_id: string;
        hostname: string;
        scan_id: string;
        prev_scan_id: string | null;
        added: number;
        removed: number;
        changed: number;
        risk_up: number;
        risk_down: number;
        returned: number;
      }>(
        `select sc.id, sc.at, sc.device_id, d.hostname, sc.scan_id, sc.prev_scan_id,
                sc.added, sc.removed, sc.changed, sc.risk_up, sc.risk_down, sc.returned
         from scan_changes sc join devices d on d.id = sc.device_id
         where sc.client_id = $1
         order by sc.at desc limit $2`,
        [clientId, Math.min(Math.max(limit, 1), 500)],
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      deviceId: r.device_id,
      deviceHostname: r.hostname,
      scanId: r.scan_id,
      prevScanId: r.prev_scan_id,
      added: r.added,
      removed: r.removed,
      changed: r.changed,
      riskUp: r.risk_up,
      riskDown: r.risk_down,
      returned: r.returned,
    }));
  });
}

export interface PortalData {
  mspName: string;
  client: Client;
  m365: M365Status | null;
  trend: TrendPoint[];
}

/**
 * A client viewer's own client. Every query runs scoped to that client, so the
 * database itself keeps other clients out of reach.
 */
export async function loadPortal(days = 90): Promise<PortalData | undefined> {
  const s = await requireViewer();
  const tenant = { mspId: s.mspId, clientId: s.clientId };
  const [got, trend] = await Promise.all([getClient(tenant, s.clientId), getTrend(tenant, days, new Date(), s.clientId)]);
  return got && { mspName: s.mspName, client: got.client, m365: got.m365, trend };
}
