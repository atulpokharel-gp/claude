// Where pages get their data: the database when DATABASE_URL is set,
// otherwise the made-up demo data.

import { hasDatabase } from "./db.ts";
import { clients as sampleClients, getClient as sampleClient, MSP_NAME } from "./sample-data.ts";
import { requireSession } from "./session.ts";
import { getClient, listClients, type UploadTokenInfo } from "./store.ts";
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

export interface ClientDetail {
  demo: boolean;
  client: Client;
  tokens: UploadTokenInfo[];
}

export async function loadClient(id: string): Promise<ClientDetail | undefined> {
  if (!hasDatabase()) {
    const client = sampleClient(id);
    return client && { demo: true, client, tokens: [] };
  }
  const s = await requireSession();
  const got = await getClient(s.mspId, id);
  return got && { demo: false, ...got };
}
