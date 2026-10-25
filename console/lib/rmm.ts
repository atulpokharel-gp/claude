// RMM integrations: NinjaOne, Datto RMM, ConnectWise Automate.
//
// A sync reads the RMM's device inventory for one client and stores each
// device under rmm_device_links. If a Zinloop device with the same hostname
// already exists for that client, the link records its id, so later scans
// show "known to the RMM" and the agent-not-reporting signal becomes real.
//
// As with PSA, every integration has mode='test' or 'live'. Test mode uses a
// deterministic in-memory fixture so an MSP can wire the console up without a
// vendor account.

import { randomUUID } from "node:crypto";
import { audit } from "./audit.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { withTenant } from "./db.ts";
import type { Session } from "./auth.ts";

export class RmmError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type RmmKind = "ninjaone" | "datto" | "automate";
export type RmmMode = "test" | "live";
export type Fetch = typeof fetch;

export interface NinjaOneConfig {
  kind: "ninjaone";
  // One of us.ninjarmm.com, eu.ninjarmm.com, oc.ninjarmm.com, ca.ninjarmm.com
  host: string;
  clientId: string;
  clientSecret: string;
}
export interface DattoConfig {
  kind: "datto";
  // e.g. "pinotage" for pinotage.centrastage.net; the host is derived.
  platform: string;
  apiKey: string;
  apiSecret: string;
}
export interface AutomateConfig {
  kind: "automate";
  // ConnectWise Automate server, e.g. "automate.msp.com".
  host: string;
  clientId: string;
  username: string;
  password: string;
}
export type RmmConfig = NinjaOneConfig | DattoConfig | AutomateConfig;

export interface RmmIntegration {
  id: string;
  mspId: string;
  kind: RmmKind;
  name: string;
  baseUrl: string;
  mode: RmmMode;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string;
  createdAt: string;
}

export interface RmmIntegrationWithConfig extends RmmIntegration {
  config: RmmConfig;
}

export interface RmmDevice {
  rmmDeviceId: string;
  hostname: string;
  os: string;
  lastSeenAt: string | null;
  tags: string[];
}

const HOST = /^[a-z0-9][a-z0-9.-]{0,250}\.[a-z]{2,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean { return UUID.test(v); }

function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

const NINJA_HOSTS = new Set(["us.ninjarmm.com", "eu.ninjarmm.com", "oc.ninjarmm.com", "ca.ninjarmm.com", "us2.ninjarmm.com"]);

export function cleanRmmConfig(input: unknown): RmmConfig {
  if (!input || typeof input !== "object") throw new RmmError("Credentials are required.");
  const o = input as Record<string, unknown>;
  switch (o.kind) {
    case "ninjaone": {
      const host = text(o.host, 250).toLowerCase();
      if (!NINJA_HOSTS.has(host)) throw new RmmError(`NinjaOne host must be one of ${[...NINJA_HOSTS].join(", ")}.`);
      const clientId = text(o.clientId, 200);
      const clientSecret = text(o.clientSecret, 200);
      if (!clientId || !clientSecret) throw new RmmError("NinjaOne needs clientId and clientSecret.");
      return { kind: "ninjaone", host, clientId, clientSecret };
    }
    case "datto": {
      const platform = text(o.platform, 100).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(platform)) throw new RmmError("Datto platform must be a short identifier like 'pinotage'.");
      const apiKey = text(o.apiKey, 200);
      const apiSecret = text(o.apiSecret, 200);
      if (!apiKey || !apiSecret) throw new RmmError("Datto RMM needs apiKey and apiSecret.");
      return { kind: "datto", platform, apiKey, apiSecret };
    }
    case "automate": {
      const host = text(o.host, 250).toLowerCase();
      if (!HOST.test(host)) throw new RmmError("Automate host must be a domain like automate.yourmsp.com.");
      const clientId = text(o.clientId, 200);
      const username = text(o.username, 200);
      const password = text(o.password, 200);
      if (!clientId || !username || !password) throw new RmmError("ConnectWise Automate needs clientId, username, and password.");
      return { kind: "automate", host, clientId, username, password };
    }
    default:
      throw new RmmError("Pick NinjaOne, Datto RMM, or ConnectWise Automate.");
  }
}

export function configBaseUrl(cfg: RmmConfig): string {
  switch (cfg.kind) {
    case "ninjaone": return `https://${cfg.host}`;
    case "datto": return `https://${cfg.platform}-api.centrastage.net`;
    case "automate": return `https://${cfg.host}`;
  }
}

interface Row {
  id: string;
  msp_id: string;
  kind: RmmKind;
  name: string;
  base_url: string;
  config_enc: string;
  mode: RmmMode;
  active: boolean;
  last_sync_at: Date | null;
  last_error: string;
  created_at: Date;
}

function rowToIntegration(r: Row): RmmIntegration {
  return {
    id: r.id, mspId: r.msp_id, kind: r.kind, name: r.name, baseUrl: r.base_url,
    mode: r.mode, active: r.active,
    lastSyncAt: r.last_sync_at?.toISOString() ?? null,
    lastError: r.last_error ?? "",
    createdAt: r.created_at.toISOString(),
  };
}

export async function listRmmIntegrations(mspId: string): Promise<RmmIntegration[]> {
  return withTenant(mspId, async (db) =>
    (await db.query<Row>("select * from rmm_integrations order by created_at")).rows.map(rowToIntegration),
  );
}

export async function getRmmIntegration(mspId: string, id: string): Promise<RmmIntegrationWithConfig | null> {
  if (!isUuid(id)) return null;
  return withTenant(mspId, async (db) => {
    const row = (await db.query<Row>("select * from rmm_integrations where id = $1", [id])).rows[0];
    if (!row) return null;
    const base = rowToIntegration(row);
    return { ...base, config: JSON.parse(decrypt(row.config_enc)) as RmmConfig };
  });
}

export interface CreateRmmInput {
  name: string;
  mode: RmmMode;
  config: unknown;
}

export async function createRmmIntegration(session: Session, input: CreateRmmInput, ip: string | null = null): Promise<RmmIntegration> {
  if (session.role !== "owner") throw new RmmError("Only the account owner can add RMM integrations.", 403);
  const name = text(input.name, 200);
  if (!name) throw new RmmError("Give the integration a name.");
  const mode: RmmMode = input.mode === "live" ? "live" : "test";
  const config = cleanRmmConfig(input.config);
  const baseUrl = configBaseUrl(config);
  const configEnc = encrypt(JSON.stringify(config));
  const id = randomUUID();
  return withTenant(session.mspId, async (db) => {
    const res = await db.query<Row>(
      `insert into rmm_integrations (id, msp_id, kind, name, base_url, config_enc, mode)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [id, session.mspId, config.kind, name, baseUrl, configEnc, mode],
    );
    await audit(session.mspId, { userId: session.userId, email: session.email, ip },
      "rmm_integration_added", name, { integrationId: id, kind: config.kind, mode }, db);
    return rowToIntegration(res.rows[0]);
  });
}

export async function removeRmmIntegration(session: Session, id: string, ip: string | null = null): Promise<void> {
  if (session.role !== "owner") throw new RmmError("Only the account owner can remove RMM integrations.", 403);
  if (!isUuid(id)) return;
  await withTenant(session.mspId, async (db) => {
    const res = await db.query<{ name: string; kind: RmmKind }>("delete from rmm_integrations where id = $1 returning name, kind", [id]);
    if (res.rows[0]) {
      await audit(session.mspId, { userId: session.userId, email: session.email, ip },
        "rmm_integration_removed", res.rows[0].name, { integrationId: id, kind: res.rows[0].kind }, db);
    }
  });
}

// Device discovery. ---------------------------------------------------------

async function ninjaToken(cfg: NinjaOneConfig, f: Fetch): Promise<string> {
  const res = await f(`https://${cfg.host}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "monitoring",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new RmmError(`NinjaOne refused sign-in: ${body.error_description ?? res.statusText}`, res.status || 502);
  return body.access_token;
}

async function ninjaDevices(cfg: NinjaOneConfig, organizationId: string, f: Fetch): Promise<RmmDevice[]> {
  const token = await ninjaToken(cfg, f);
  const orgId = Number(organizationId);
  if (!Number.isFinite(orgId)) throw new RmmError("NinjaOne needs the client's numeric organization ID.");
  const res = await f(`${configBaseUrl(cfg)}/v2/organization/${orgId}/devices`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const body = (await res.json().catch(() => [])) as Array<{
    id?: number; systemName?: string; dnsName?: string; nodeClass?: string; offline?: boolean; lastContact?: number; tags?: string[];
  }>;
  if (!res.ok || !Array.isArray(body)) throw new RmmError(`NinjaOne refused the device list: ${res.statusText}`, res.status || 502);
  return body.map((d) => ({
    rmmDeviceId: String(d.id ?? ""),
    hostname: (d.systemName || d.dnsName || "").trim(),
    os: (d.nodeClass || "").slice(0, 50),
    lastSeenAt: d.lastContact ? new Date(d.lastContact * 1000).toISOString() : null,
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
  }));
}

async function dattoDevices(cfg: DattoConfig, siteId: string, f: Fetch): Promise<RmmDevice[]> {
  const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
  const res = await f(`${configBaseUrl(cfg)}/api/v2/site/${encodeURIComponent(siteId)}/devices`, {
    headers: { authorization: `Basic ${auth}`, accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as { devices?: Array<{ uid?: string; hostname?: string; operatingSystem?: string; lastSeen?: string; tags?: Array<{ name?: string }> }>; message?: string };
  if (!res.ok) throw new RmmError(`Datto RMM refused the device list: ${body.message ?? res.statusText}`, res.status || 502);
  const list = body.devices ?? [];
  return list.map((d) => ({
    rmmDeviceId: String(d.uid ?? ""),
    hostname: (d.hostname ?? "").trim(),
    os: (d.operatingSystem ?? "").slice(0, 50),
    lastSeenAt: d.lastSeen ?? null,
    tags: (d.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
  }));
}

async function automateDevices(cfg: AutomateConfig, clientNumber: string, f: Fetch): Promise<RmmDevice[]> {
  // ConnectWise Automate uses an older "Control Center" REST surface; the
  // sign-in and endpoint names below mirror what the vendor's docs show.
  const tokenRes = await f(`${configBaseUrl(cfg)}/cwa/api/v1/apitoken`, {
    method: "POST",
    headers: { "content-type": "application/json", clientid: cfg.clientId },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { Token?: string; Message?: string };
  if (!tokenRes.ok || !tokenBody.Token) {
    throw new RmmError(`Automate refused sign-in: ${tokenBody.Message ?? tokenRes.statusText}`, tokenRes.status || 502);
  }
  const n = Number(clientNumber);
  if (!Number.isFinite(n)) throw new RmmError("Automate needs the client's numeric ID.");
  const res = await f(`${configBaseUrl(cfg)}/cwa/api/v1/clients/${n}/computers?pagesize=500`, {
    headers: { authorization: `Bearer ${tokenBody.Token}`, clientid: cfg.clientId, accept: "application/json" },
  });
  const body = (await res.json().catch(() => [])) as Array<{ Id?: number; ComputerName?: string; OperatingSystemName?: string; LastContact?: string }>;
  if (!res.ok) throw new RmmError(`Automate refused the device list: ${res.statusText}`, res.status || 502);
  return body.map((d) => ({
    rmmDeviceId: String(d.Id ?? ""),
    hostname: (d.ComputerName ?? "").trim(),
    os: (d.OperatingSystemName ?? "").slice(0, 50),
    lastSeenAt: d.LastContact ?? null,
    tags: [],
  }));
}

function mockDevices(kind: RmmKind, orgId: string): RmmDevice[] {
  const n = Math.abs(hash(orgId)) % 5 + 2;
  const now = new Date().toISOString();
  return Array.from({ length: n }, (_, i) => ({
    rmmDeviceId: `${kind}-${orgId.slice(0, 24)}-${i + 1}`,
    hostname: `${kind}-host-${orgId.slice(0, 12) || "test"}-${i + 1}`,
    os: i % 2 ? "Windows 11" : "macOS 14",
    lastSeenAt: now,
    tags: ["zinloop:mock"],
  }));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export async function fetchDevices(integration: RmmIntegrationWithConfig, organizationId: string, f: Fetch = fetch): Promise<RmmDevice[]> {
  const org = text(organizationId, 100);
  if (!org) throw new RmmError("The client has no RMM organization ID set.");
  if (!integration.active) throw new RmmError("This integration is turned off.");
  if (integration.mode === "test") return mockDevices(integration.kind, org);
  const cfg = integration.config;
  switch (cfg.kind) {
    case "ninjaone": return ninjaDevices(cfg, org, f);
    case "datto": return dattoDevices(cfg, org, f);
    case "automate": return automateDevices(cfg, org, f);
  }
}

/**
 * Read the RMM's devices for a client and upsert links. A link matches a
 * Zinloop device by (client_id, hostname); mismatches stay unlinked so the UI
 * can show "known to RMM, no scan yet".
 */
export async function syncClientDevices(mspId: string, clientId: string, integrationId: string, organizationId: string, f: Fetch = fetch): Promise<{ added: number; updated: number; linked: number; total: number }> {
  if (!isUuid(clientId)) throw new RmmError("That client wasn't found.");
  const integration = await getRmmIntegration(mspId, integrationId);
  if (!integration) throw new RmmError("That RMM integration wasn't found.");
  let devices: RmmDevice[];
  try {
    devices = await fetchDevices(integration, organizationId, f);
  } catch (err) {
    await withTenant(mspId, (db) =>
      db.query("update rmm_integrations set last_error = $2 where id = $1", [integrationId, (err as Error).message.slice(0, 500)]),
    );
    throw err;
  }
  const summary = { added: 0, updated: 0, linked: 0, total: devices.length };
  await withTenant(mspId, async (db) => {
    for (const d of devices) {
      if (!d.rmmDeviceId || !d.hostname) continue;
      const localDevice = (await db.query<{ id: string }>("select id from devices where client_id = $1 and hostname = $2", [clientId, d.hostname])).rows[0];
      const linkedDeviceId = localDevice?.id ?? null;
      const res = await db.query<{ xmax: string }>(
        `insert into rmm_device_links (msp_id, integration_id, client_id, rmm_device_id, hostname, os, device_id, last_seen_at, tags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         on conflict (integration_id, rmm_device_id) do update set
           hostname = excluded.hostname,
           os = excluded.os,
           device_id = coalesce(excluded.device_id, rmm_device_links.device_id),
           last_seen_at = excluded.last_seen_at,
           tags = excluded.tags
         returning (xmax = 0) as added`,
        [mspId, integrationId, clientId, d.rmmDeviceId, d.hostname, d.os, linkedDeviceId, d.lastSeenAt, JSON.stringify(d.tags)],
      );
      // pg's "returning xmax = 0" trick lets us tell insert from update.
      const added = (res.rows[0] as unknown as { added: boolean }).added;
      if (added) summary.added++;
      else summary.updated++;
      if (linkedDeviceId) summary.linked++;
    }
    await db.query("update rmm_integrations set last_sync_at = now(), last_error = '' where id = $1", [integrationId]);
  });
  return summary;
}

export interface DeviceLink {
  id: string;
  rmmDeviceId: string;
  integrationId: string;
  clientId: string;
  hostname: string;
  os: string;
  deviceId: string | null;
  lastSeenAt: string | null;
  tags: string[];
}

export async function listDeviceLinks(mspId: string, clientId: string): Promise<DeviceLink[]> {
  if (!isUuid(clientId)) return [];
  return withTenant(mspId, async (db) =>
    (await db.query<{
      id: string; rmm_device_id: string; integration_id: string; client_id: string;
      hostname: string; os: string; device_id: string | null; last_seen_at: Date | null; tags: string[];
    }>(
      "select * from rmm_device_links where client_id = $1 order by hostname",
      [clientId],
    )).rows.map((r) => ({
      id: r.id, rmmDeviceId: r.rmm_device_id, integrationId: r.integration_id, clientId: r.client_id,
      hostname: r.hostname, os: r.os, deviceId: r.device_id,
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      tags: Array.isArray(r.tags) ? r.tags : [],
    })),
  );
}
