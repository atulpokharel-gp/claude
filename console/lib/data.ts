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
