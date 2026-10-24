// Reading and writing an MSP's clients, upload tokens and scans.

import { checkClientLimit, PLAN_LIMITS, type Plan } from "./accounts.ts";
import { lookup, withTenant } from "./db.ts";
import { appToAgent, discover, GraphError, revokeApp, TENANT_ID, type Fetch, type M365App } from "./m365.ts";
import { snapshotOf } from "./insights.ts";
import { importScan, ScanImportError } from "./scan-import.ts";
import { newToken, tokenHash } from "./secrets.ts";
import type { Agent, Client } from "./types.ts";

/** A device counts as scanned when its last scan is this recent. */
export const SCAN_FRESH_DAYS = 7;
export const MAX_REPORT_BYTES = 2 * 1024 * 1024;

interface ClientRow {
  id: string;
  name: string;
  industry: string;
  staff: number;
  devices_expected: number;
}
interface DeviceScanRow {
  client_id: string;
  device_id: string;
  hostname: string;
  last_scan_at: Date | null;
  report: unknown;
}

interface M365Row {
  client_id: string;
  tenant_id: string;
  last_sync_at: Date | null;
  last_error: string | null;
  apps: M365App[];
}

export interface M365Status {
  tenantId: string;
  lastSync: string | null;
  lastError: string | null;
}

function buildClient(c: ClientRow, rows: DeviceScanRow[], now: Date, m365?: M365Row): Client {
  const fresh = now.getTime() - SCAN_FRESH_DAYS * 86_400_000;
  const agents: Agent[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  let lastScan = "";
  for (const r of rows) {
    if (!r.report) continue;
    let device: Client;
    try {
      device = importScan(r.report);
    } catch {
      warnings.push(`The last scan from ${r.hostname} couldn't be read.`);
      continue;
    }
    device.agents.forEach((a, i) => agents.push({ ...a, id: `${r.device_id}-${i}` }));
    warnings.push(...(device.warnings ?? []).map((w) => `${r.hostname}: ${w}`));
    const at = r.last_scan_at?.toISOString() ?? "";
    if (at > lastScan) lastScan = at;
    if (r.last_scan_at && r.last_scan_at.getTime() >= fresh && (device.warnings ?? []).length === 0) scanned++;
  }
  if (m365) {
    const seen = (m365.last_sync_at ?? now).toISOString();
    for (const app of m365.apps) agents.push(appToAgent(app, c.name, seen));
  }
  return {
    id: c.id,
    name: c.name,
    industry: c.industry,
    staff: c.staff,
    devices: Math.max(c.devices_expected, rows.length),
    devicesScanned: scanned,
    lastScan: lastScan || new Date(0).toISOString(),
    agents,
    warnings,
  };
}

const LATEST_SCANS = `
  select d.client_id, d.id as device_id, d.hostname, d.last_scan_at, s.report
  from devices d
  left join lateral (
    select report from scans where scans.device_id = d.id order by scanned_at desc, received_at desc limit 1
  ) s on true`;

export async function listClients(mspId: string, now = new Date()): Promise<Client[]> {
  return withTenant(mspId, async (db) => {
    const clients = (await db.query<ClientRow>("select * from clients order by name")).rows;
    const rows = (await db.query<DeviceScanRow>(LATEST_SCANS)).rows;
    const tenants = (await db.query<M365Row>("select * from m365_tenants")).rows;
    return clients.map((c) =>
      buildClient(c, rows.filter((r) => r.client_id === c.id), now, tenants.find((t) => t.client_id === c.id)),
    );
  });
}

export interface UploadTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsed: string | null;
}

export async function getClient(
  mspId: string,
  clientId: string,
  now = new Date(),
): Promise<{ client: Client; tokens: UploadTokenInfo[]; m365: M365Status | null } | undefined> {
  if (!isUuid(clientId)) return undefined;
  return withTenant(mspId, async (db) => {
    const c = (await db.query<ClientRow>("select * from clients where id = $1", [clientId])).rows[0];
    if (!c) return undefined;
    const rows = (await db.query<DeviceScanRow>(`${LATEST_SCANS} where d.client_id = $1`, [clientId])).rows;
    const tokens = (
      await db.query<{ id: string; label: string; created_at: Date; last_used: Date | null }>(
        "select id, label, created_at, last_used from upload_tokens where client_id = $1 and revoked_at is null order by created_at",
        [clientId],
      )
    ).rows.map((t) => ({
      id: t.id,
      label: t.label,
      createdAt: t.created_at.toISOString(),
      lastUsed: t.last_used?.toISOString() ?? null,
    }));
    const t = (await db.query<M365Row>("select * from m365_tenants where client_id = $1", [clientId])).rows[0];
    const m365 = t ? { tenantId: t.tenant_id, lastSync: t.last_sync_at?.toISOString() ?? null, lastError: t.last_error } : null;
    return { client: buildClient(c, rows, now, t), tokens, m365 };
  });
}

export interface NewClient {
  name: string;
  industry?: string;
  staff?: number;
  devicesExpected?: number;
}

export async function createClient(mspId: string, input: NewClient): Promise<string> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new Error("Client name must be 1 to 200 characters.");
  return withTenant(mspId, async (db) => {
    await checkClientLimit(db);
    const res = await db.query<{ id: string }>(
      "insert into clients (msp_id, name, industry, staff, devices_expected) values ($1, $2, $3, $4, $5) returning id",
      [mspId, name, (input.industry ?? "").trim().slice(0, 200), clampInt(input.staff), clampInt(input.devicesExpected)],
    );
    return res.rows[0].id;
  });
}

/** Creates a token laptops use to send scans for one client. The token is returned once and never stored. */
export async function createUploadToken(mspId: string, clientId: string, label: string): Promise<string> {
  if (!isUuid(clientId)) throw new Error("Unknown client.");
  const token = newToken("zlu");
  await withTenant(mspId, async (db) => {
    const res = await db.query(
      `insert into upload_tokens (msp_id, client_id, token_hash, label)
       select $1, id, $3, $4 from clients where id = $2`,
      [mspId, clientId, tokenHash(token), label.trim().slice(0, 200)],
    );
    if (res.rowCount !== 1) throw new Error("Unknown client.");
  });
  return token;
}

export async function revokeUploadToken(mspId: string, tokenId: string): Promise<void> {
  if (!isUuid(tokenId)) return;
  await withTenant(mspId, (db) => db.query("update upload_tokens set revoked_at = now() where id = $1", [tokenId]));
}

export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Stores a scan sent by a laptop. Throws UploadError with an HTTP status on bad input. */
export async function ingestScan(token: string | undefined, report: unknown, now = new Date()) {
  const saved = await saveScan(token, report, now);
  await snapshotClient(saved.mspId, saved.clientId, now);
  return { clientId: saved.clientId, deviceId: saved.deviceId };
}

async function saveScan(token: string | undefined, report: unknown, now: Date) {
  // agu_ tokens were issued before the rename and are still valid.
  if (!token || !(token.startsWith("zlu_") || token.startsWith("agu_"))) throw new UploadError("Missing or malformed upload token.", 401);
  const owner = await lookup<{ client_id: string; msp_id: string }>("select * from upload_check_token($1)", [
    tokenHash(token),
  ]);
  if (!owner) throw new UploadError("Upload token not recognized or revoked.", 401);

  try {
    importScan(report); // same checks the console uses to read it back
  } catch (err) {
    if (err instanceof ScanImportError) throw new UploadError(err.message, 400);
    throw err;
  }
  const r = report as Record<string, unknown>;
  const hostname = typeof r.hostname === "string" ? r.hostname.trim() : "";
  if (!hostname || hostname.length > 255) throw new UploadError("The report has no hostname.", 400);
  const os = typeof r.os === "string" ? r.os.slice(0, 50) : "";
  let scannedAt = new Date(typeof r.scannedAt === "string" ? r.scannedAt : NaN);
  // A wrong clock on the laptop shouldn't put scans in the future.
  if (Number.isNaN(scannedAt.getTime()) || scannedAt > now) scannedAt = now;

  return withTenant(owner.msp_id, async (db) => {
    const plan = (await db.query<{ plan: Plan }>("select plan from msps")).rows[0]?.plan ?? "free";
    const limit = PLAN_LIMITS[plan].devices;
    if (Number.isFinite(limit)) {
      const known = await db.query("select 1 from devices where client_id = $1 and hostname = $2", [owner.client_id, hostname]);
      if (known.rowCount === 0) {
        const n = (await db.query<{ n: number }>("select count(*)::int as n from devices")).rows[0].n;
        if (n >= limit) {
          throw new UploadError(`The free plan covers ${limit} laptops and this account has reached it.`, 403);
        }
      }
    }
    const device = await db.query<{ id: string }>(
      `insert into devices (msp_id, client_id, hostname, os, last_scan_at)
       values ($1, $2, $3, $4, $5)
       on conflict (client_id, hostname) do update set os = excluded.os,
         last_scan_at = greatest(devices.last_scan_at, excluded.last_scan_at)
       returning id`,
      // When the scan ran, not when it arrived, so a late upload doesn't look fresh.
      [owner.msp_id, owner.client_id, hostname, os, scannedAt],
    );
    const deviceId = device.rows[0].id;
    await db.query(
      "insert into scans (msp_id, client_id, device_id, scanned_at, report) values ($1, $2, $3, $4, $5)",
      [owner.msp_id, owner.client_id, deviceId, scannedAt, JSON.stringify(report)],
    );
    return { mspId: owner.msp_id, clientId: owner.client_id, deviceId };
  });
}

/** Links a client to its Microsoft 365 tenant after the admin granted consent. */
export async function connectM365(mspId: string, clientId: string, tenantId: string): Promise<void> {
  if (!isUuid(clientId) || !TENANT_ID.test(tenantId)) throw new Error("Unknown client or tenant.");
  await withTenant(mspId, async (db) => {
    const res = await db.query(
      `insert into m365_tenants (client_id, msp_id, tenant_id)
       select id, $1, $3 from clients where id = $2
       on conflict (client_id) do update set tenant_id = excluded.tenant_id, connected_at = now(), last_error = null`,
      [mspId, clientId, tenantId.toLowerCase()],
    );
    if (res.rowCount !== 1) throw new Error("Unknown client.");
  });
}

export async function disconnectM365(mspId: string, clientId: string): Promise<void> {
  if (!isUuid(clientId)) return;
  await withTenant(mspId, (db) => db.query("delete from m365_tenants where client_id = $1", [clientId]));
  await snapshotClient(mspId, clientId);
}

/** Reads the tenant's AI app grants from Microsoft and stores them. Errors are stored too, for the page to show. */
export async function syncM365(mspId: string, clientId: string, f: Fetch = fetch): Promise<{ apps: number } | { error: string }> {
  if (!isUuid(clientId)) return { error: "Unknown client." };
  const t = await withTenant(mspId, async (db) =>
    (await db.query<{ tenant_id: string }>("select tenant_id from m365_tenants where client_id = $1", [clientId])).rows[0],
  );
  if (!t) return { error: "Microsoft 365 isn't connected for this client." };
  try {
    const apps = await discover(t.tenant_id, f);
    await withTenant(mspId, (db) =>
      db.query("update m365_tenants set apps = $2, last_sync_at = now(), last_error = null where client_id = $1", [
        clientId,
        JSON.stringify(apps),
      ]),
    );
    await snapshotClient(mspId, clientId);
    return { apps: apps.length };
  } catch (err) {
    const message = err instanceof GraphError ? err.message : "Couldn't reach Microsoft 365.";
    await withTenant(mspId, (db) => db.query("update m365_tenants set last_error = $2 where client_id = $1", [clientId, message]));
    return { error: message };
  }
}

/** Revokes every grant of one AI app in the client's tenant, then re-reads the tenant. */
/** Returns the app's name. */
export async function revokeM365App(mspId: string, clientId: string, agentId: string, f: Fetch = fetch): Promise<string> {
  if (!isUuid(clientId) || !agentId.startsWith("m365-")) throw new Error("Unknown app.");
  const t = await withTenant(mspId, async (db) =>
    (await db.query<M365Row>("select * from m365_tenants where client_id = $1", [clientId])).rows[0],
  );
  const app = t?.apps.find((a) => `m365-${a.servicePrincipalId}` === agentId);
  if (!t || !app) throw new Error("That app isn't in this client's Microsoft 365 any more.");
  await revokeApp(t.tenant_id, app, f);
  await syncM365(mspId, clientId, f);
  return app.name;
}

/**
 * Saves today's risk counts for a client, for the trend chart. Never throws:
 * a failed snapshot must not fail the upload or sync that triggered it.
 */
export async function snapshotClient(mspId: string, clientId: string, now = new Date()): Promise<void> {
  try {
    const got = await getClient(mspId, clientId, now);
    if (!got) return;
    const s = snapshotOf(got.client);
    await withTenant(mspId, (db) =>
      db.query(
        `insert into risk_snapshots (client_id, msp_id, day, high, medium, low, tools, people)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (client_id, day) do update set high = excluded.high, medium = excluded.medium,
           low = excluded.low, tools = excluded.tools, people = excluded.people`,
        [clientId, mspId, now.toISOString().slice(0, 10), s.high, s.medium, s.low, s.tools, s.people],
      ),
    );
  } catch (err) {
    console.error(`risk snapshot for client ${clientId} failed: ${(err as Error).message}`);
  }
}

export interface TrendPoint {
  day: string; // YYYY-MM-DD
  high: number;
  medium: number;
  low: number;
  tools: number;
}

/**
 * Risk counts per day for the last `days` days, summed across clients (or one
 * client). A day with no new snapshot carries each client's last known counts.
 */
export async function getTrend(mspId: string, days = 90, now = new Date(), clientId?: string): Promise<TrendPoint[]> {
  const first = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await withTenant(mspId, async (db) =>
    (
      await db.query<{ client_id: string; day: string; high: number; medium: number; low: number; tools: number }>(
        `select client_id, to_char(day, 'YYYY-MM-DD') as day, high, medium, low, tools from risk_snapshots
         where ($2::uuid is null or client_id = $2)
           and (day >= $1 or day = (select max(day) from risk_snapshots r2 where r2.client_id = risk_snapshots.client_id and r2.day < $1))
         order by day`,
        [first, clientId && isUuid(clientId) ? clientId : null],
      )
    ).rows,
  );
  const latest = new Map<string, (typeof rows)[number]>();
  let i = 0;
  const out: TrendPoint[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(Date.parse(`${first}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    while (i < rows.length && rows[i].day <= day) latest.set(rows[i].client_id, rows[i++]);
    const p: TrendPoint = { day, high: 0, medium: 0, low: 0, tools: 0 };
    for (const r of latest.values()) {
      p.high += r.high;
      p.medium += r.medium;
      p.low += r.low;
      p.tools += r.tools;
    }
    out.push(p);
  }
  return out;
}

function clampInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID.test(v);
}
