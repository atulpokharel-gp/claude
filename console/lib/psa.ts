// PSA integrations: ConnectWise Manage, Autotask PSA, HaloPSA.
//
// A ticket is opened once per (client, finding_key); a repeat scan with the
// same finding doesn't open a new one, so the technician's queue stays sane.
// Credentials sit in psa_integrations.config_enc, encrypted with APP_SECRET.
//
// Each integration has mode='test' or 'live'. In test mode no network is
// touched; openTicket returns a deterministic synthetic external_id so an MSP
// can wire the console up without a vendor account. The HTTP calls go through
// an injected Fetch so the tests here can assert the request shape without a
// server.

import { randomUUID } from "node:crypto";
import { audit } from "./audit.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { withTenant, type Db } from "./db.ts";
import type { Session } from "./auth.ts";

export class PsaError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type PsaKind = "connectwise" | "autotask" | "halopsa";
export type PsaMode = "test" | "live";
export type Fetch = typeof fetch;

// Config shapes. The caller validates against these before encrypting.
export interface ConnectWiseConfig {
  kind: "connectwise";
  site: string;              // e.g. "na.myconnectwise.net" (hostname only).
  companyId: string;
  publicKey: string;
  privateKey: string;
  clientId: string;          // "ClientID" header value.
  boardId?: number;
}
export interface AutotaskConfig {
  kind: "autotask";
  apiIntegrationCode: string;
  userName: string;
  secret: string;
  // Base URL Autotask returns from the zoneInformation endpoint, e.g.
  // "https://webservices2.autotask.net/ATServicesRest/V1.0".
  zoneUrl: string;
  queueId?: number;
}
export interface HaloPsaConfig {
  kind: "halopsa";
  site: string;              // host only, e.g. "yourmsp.halopsa.com".
  clientId: string;
  clientSecret: string;
  ticketTypeId?: number;
  teamId?: number;
}
export type PsaConfig = ConnectWiseConfig | AutotaskConfig | HaloPsaConfig;

export interface PsaIntegration {
  id: string;
  mspId: string;
  kind: PsaKind;
  name: string;
  baseUrl: string;
  mode: PsaMode;
  active: boolean;
  lastCheckAt: string | null;
  lastError: string;
  createdAt: string;
}

export interface PsaIntegrationWithConfig extends PsaIntegration {
  config: PsaConfig;
}

export interface NewTicket {
  summary: string;
  description: string;
  companyId: string;
  severity: "high" | "medium" | "low";
  findingKey: string;
}

export interface TicketResult {
  externalId: string;
  url?: string;
}

const HOST = /^[a-z0-9][a-z0-9.-]{0,250}\.[a-z]{2,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean { return UUID.test(v); }

function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/** Parse and validate a config a user typed in. Throws PsaError on bad input. */
export function cleanConfig(input: unknown): PsaConfig {
  if (!input || typeof input !== "object") throw new PsaError("Credentials are required.");
  const o = input as Record<string, unknown>;
  switch (o.kind) {
    case "connectwise": {
      const site = text(o.site, 250).toLowerCase();
      if (!HOST.test(site)) throw new PsaError("Enter the ConnectWise site, e.g. na.myconnectwise.net.");
      const companyId = text(o.companyId, 100);
      const publicKey = text(o.publicKey, 200);
      const privateKey = text(o.privateKey, 200);
      const clientId = text(o.clientId, 200);
      if (!companyId || !publicKey || !privateKey || !clientId) throw new PsaError("ConnectWise needs companyId, publicKey, privateKey, and clientId.");
      const boardId = o.boardId == null || o.boardId === "" ? undefined : Number(o.boardId);
      if (boardId !== undefined && !Number.isInteger(boardId)) throw new PsaError("Board ID must be a whole number.");
      return { kind: "connectwise", site, companyId, publicKey, privateKey, clientId, ...(boardId !== undefined ? { boardId } : {}) };
    }
    case "autotask": {
      const apiIntegrationCode = text(o.apiIntegrationCode, 200);
      const userName = text(o.userName, 200);
      const secret = text(o.secret, 200);
      const zoneUrl = text(o.zoneUrl, 500);
      if (!apiIntegrationCode || !userName || !secret) throw new PsaError("Autotask needs apiIntegrationCode, userName, and secret.");
      let u: URL;
      try { u = new URL(zoneUrl); } catch { throw new PsaError("Zone URL must be the base URL Autotask gave you."); }
      if (u.protocol !== "https:") throw new PsaError("Zone URL must use https.");
      const queueId = o.queueId == null || o.queueId === "" ? undefined : Number(o.queueId);
      if (queueId !== undefined && !Number.isInteger(queueId)) throw new PsaError("Queue ID must be a whole number.");
      return { kind: "autotask", apiIntegrationCode, userName, secret, zoneUrl: u.toString().replace(/\/+$/, ""), ...(queueId !== undefined ? { queueId } : {}) };
    }
    case "halopsa": {
      const site = text(o.site, 250).toLowerCase();
      if (!HOST.test(site)) throw new PsaError("Enter the HaloPSA site, e.g. yourmsp.halopsa.com.");
      const clientId = text(o.clientId, 200);
      const clientSecret = text(o.clientSecret, 200);
      if (!clientId || !clientSecret) throw new PsaError("HaloPSA needs clientId and clientSecret.");
      const ticketTypeId = o.ticketTypeId == null || o.ticketTypeId === "" ? undefined : Number(o.ticketTypeId);
      const teamId = o.teamId == null || o.teamId === "" ? undefined : Number(o.teamId);
      if (ticketTypeId !== undefined && !Number.isInteger(ticketTypeId)) throw new PsaError("Ticket type ID must be a whole number.");
      if (teamId !== undefined && !Number.isInteger(teamId)) throw new PsaError("Team ID must be a whole number.");
      return {
        kind: "halopsa", site, clientId, clientSecret,
        ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
      };
    }
    default:
      throw new PsaError("Pick ConnectWise, Autotask, or HaloPSA.");
  }
}

export function configBaseUrl(cfg: PsaConfig): string {
  switch (cfg.kind) {
    case "connectwise": return `https://${cfg.site}/v4_6_release/apis/3.0`;
    case "autotask": return cfg.zoneUrl;
    case "halopsa": return `https://${cfg.site}/api`;
  }
}

interface Row {
  id: string;
  msp_id: string;
  kind: PsaKind;
  name: string;
  base_url: string;
  config_enc: string;
  mode: PsaMode;
  active: boolean;
  last_check_at: Date | null;
  last_error: string;
  created_at: Date;
}

function rowToIntegration(r: Row): PsaIntegration {
  return {
    id: r.id,
    mspId: r.msp_id,
    kind: r.kind,
    name: r.name,
    baseUrl: r.base_url,
    mode: r.mode,
    active: r.active,
    lastCheckAt: r.last_check_at?.toISOString() ?? null,
    lastError: r.last_error ?? "",
    createdAt: r.created_at.toISOString(),
  };
}

export async function listPsaIntegrations(mspId: string): Promise<PsaIntegration[]> {
  return withTenant(mspId, async (db) =>
    (await db.query<Row>("select * from psa_integrations order by created_at")).rows.map(rowToIntegration),
  );
}

export async function getPsaIntegration(mspId: string, id: string): Promise<PsaIntegrationWithConfig | null> {
  if (!isUuid(id)) return null;
  return withTenant(mspId, async (db) => {
    const row = (await db.query<Row>("select * from psa_integrations where id = $1", [id])).rows[0];
    if (!row) return null;
    const base = rowToIntegration(row);
    return { ...base, config: JSON.parse(decrypt(row.config_enc)) as PsaConfig };
  });
}

export interface CreatePsaInput {
  name: string;
  mode: PsaMode;
  config: unknown;
}

/** Owner-only. The config is validated, then stored encrypted. */
export async function createPsaIntegration(session: Session, input: CreatePsaInput, ip: string | null = null): Promise<PsaIntegration> {
  if (session.role !== "owner") throw new PsaError("Only the account owner can add PSA integrations.", 403);
  const name = text(input.name, 200);
  if (!name) throw new PsaError("Give the integration a name.");
  const mode: PsaMode = input.mode === "live" ? "live" : "test";
  const config = cleanConfig(input.config);
  const baseUrl = configBaseUrl(config);
  const configEnc = encrypt(JSON.stringify(config));
  const id = randomUUID();
  return withTenant(session.mspId, async (db) => {
    const res = await db.query<Row>(
      `insert into psa_integrations (id, msp_id, kind, name, base_url, config_enc, mode)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [id, session.mspId, config.kind, name, baseUrl, configEnc, mode],
    );
    await audit(session.mspId, { userId: session.userId, email: session.email, ip }, "psa_integration_added",
      name, { integrationId: id, kind: config.kind, mode }, db);
    return rowToIntegration(res.rows[0]);
  });
}

export async function removePsaIntegration(session: Session, id: string, ip: string | null = null): Promise<void> {
  if (session.role !== "owner") throw new PsaError("Only the account owner can remove PSA integrations.", 403);
  if (!isUuid(id)) return;
  await withTenant(session.mspId, async (db) => {
    const res = await db.query<{ name: string; kind: PsaKind }>("delete from psa_integrations where id = $1 returning name, kind", [id]);
    if (res.rows[0]) {
      await audit(session.mspId, { userId: session.userId, email: session.email, ip },
        "psa_integration_removed", res.rows[0].name, { integrationId: id, kind: res.rows[0].kind }, db);
    }
  });
}

// Ticket creation. ----------------------------------------------------------

const SEVERITY_CW: Record<NewTicket["severity"], string> = { high: "High", medium: "Medium", low: "Low" };
const SEVERITY_AUTOTASK: Record<NewTicket["severity"], number> = { high: 1, medium: 2, low: 3 };
const SEVERITY_HALO: Record<NewTicket["severity"], number> = { high: 1, medium: 2, low: 3 };

async function connectWiseTicket(cfg: ConnectWiseConfig, t: NewTicket, f: Fetch): Promise<TicketResult> {
  const auth = Buffer.from(`${cfg.companyId}+${cfg.publicKey}:${cfg.privateKey}`).toString("base64");
  const body = {
    summary: t.summary.slice(0, 100),
    initialDescription: t.description,
    severity: SEVERITY_CW[t.severity],
    priority: { id: t.severity === "high" ? 1 : t.severity === "medium" ? 2 : 3 },
    company: { identifier: t.companyId },
    ...(cfg.boardId ? { board: { id: cfg.boardId } } : {}),
  };
  const res = await f(`${configBaseUrl(cfg)}/service/tickets`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      clientid: cfg.clientId,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { id?: number; _info?: { ticket_href?: string }; errors?: Array<{ message?: string }>; message?: string };
  if (!res.ok || payload.id == null) {
    const msg = payload.errors?.[0]?.message ?? payload.message ?? res.statusText;
    throw new PsaError(`ConnectWise refused the ticket: ${msg}`, res.status || 502);
  }
  return { externalId: String(payload.id), ...(payload._info?.ticket_href ? { url: payload._info.ticket_href } : {}) };
}

async function autotaskTicket(cfg: AutotaskConfig, t: NewTicket, f: Fetch): Promise<TicketResult> {
  const body = {
    Title: t.summary.slice(0, 255),
    Description: t.description.slice(0, 8000),
    Priority: SEVERITY_AUTOTASK[t.severity],
    Status: 1, // "New"
    CompanyID: Number(t.companyId) || 0,
    ...(cfg.queueId ? { QueueID: cfg.queueId } : {}),
  };
  if (!body.CompanyID) throw new PsaError("Autotask needs a numeric company ID for this client.", 400);
  const res = await f(`${configBaseUrl(cfg)}/Tickets`, {
    method: "POST",
    headers: {
      ApiIntegrationCode: cfg.apiIntegrationCode,
      UserName: cfg.userName,
      Secret: cfg.secret,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { itemId?: number; message?: string; errors?: string[] };
  if (!res.ok || payload.itemId == null) {
    const msg = payload.errors?.[0] ?? payload.message ?? res.statusText;
    throw new PsaError(`Autotask refused the ticket: ${msg}`, res.status || 502);
  }
  return { externalId: String(payload.itemId) };
}

async function haloToken(cfg: HaloPsaConfig, f: Fetch): Promise<string> {
  const res = await f(`https://${cfg.site}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "all",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new PsaError(`HaloPSA refused the sign-in: ${body.error_description ?? res.statusText}`, res.status || 502);
  }
  return body.access_token;
}

async function haloTicket(cfg: HaloPsaConfig, t: NewTicket, f: Fetch): Promise<TicketResult> {
  const token = await haloToken(cfg, f);
  const body = [{
    summary: t.summary.slice(0, 200),
    details: t.description,
    client_id: Number(t.companyId) || undefined,
    priority_id: SEVERITY_HALO[t.severity],
    ...(cfg.ticketTypeId ? { tickettype_id: cfg.ticketTypeId } : {}),
    ...(cfg.teamId ? { team_id: cfg.teamId } : {}),
  }];
  const res = await f(`${configBaseUrl(cfg)}/Tickets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as Array<{ id?: number }> | { id?: number; message?: string };
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!res.ok || !first?.id) {
    const msg = (Array.isArray(payload) ? "" : payload.message) ?? res.statusText;
    throw new PsaError(`HaloPSA refused the ticket: ${msg}`, res.status || 502);
  }
  return { externalId: String(first.id) };
}

/** Mock transport for test mode: builds a deterministic external_id. */
function mockTicket(kind: PsaKind, t: NewTicket): TicketResult {
  const stem = t.findingKey.replace(/[^a-z0-9]/gi, "").slice(0, 20) || "zinloop";
  return { externalId: `${kind}-${stem}-${Math.abs(hash(t.findingKey)) % 100000}` };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export async function openTicket(
  integration: PsaIntegrationWithConfig,
  ticket: NewTicket,
  f: Fetch = fetch,
): Promise<TicketResult> {
  const summary = text(ticket.summary, 500);
  if (!summary) throw new PsaError("Ticket needs a summary.");
  const description = text(ticket.description, 8000) || summary;
  const companyId = text(ticket.companyId, 100);
  if (!companyId) throw new PsaError("Ticket needs the PSA company ID for the client.");
  if (!integration.active) throw new PsaError("This integration is turned off.");
  const t: NewTicket = { ...ticket, summary, description, companyId };
  if (integration.mode === "test") return mockTicket(integration.kind, t);
  const cfg = integration.config;
  switch (cfg.kind) {
    case "connectwise": return connectWiseTicket(cfg, t, f);
    case "autotask": return autotaskTicket(cfg, t, f);
    case "halopsa": return haloTicket(cfg, t, f);
  }
}

/**
 * Opens a ticket for a (client, finding_key) pair, deduping with a database
 * unique constraint. Returns the created or existing row. Errors are stored
 * on the row and re-raised.
 */
export interface OpenForFinding {
  mspId: string;
  clientId: string;
  integrationId: string;
  finding: NewTicket;
  f?: Fetch;
}

export interface StoredTicket {
  id: string;
  clientId: string;
  integrationId: string;
  findingKey: string;
  externalId: string;
  summary: string;
  status: "open" | "closed" | "failed";
  lastError: string;
  createdAt: string;
}

export async function openTicketForFinding(o: OpenForFinding): Promise<StoredTicket> {
  if (!isUuid(o.clientId)) throw new PsaError("That client wasn't found.");
  const integration = await getPsaIntegration(o.mspId, o.integrationId);
  if (!integration) throw new PsaError("That PSA integration wasn't found.");
  const existing = await withTenant(o.mspId, async (db) =>
    (await db.query<StoredRow>(
      "select * from psa_tickets where client_id = $1 and finding_key = $2",
      [o.clientId, o.finding.findingKey],
    )).rows[0],
  );
  if (existing) return storedRowTo(existing);

  let externalId = "";
  let errorMsg = "";
  try {
    const result = await openTicket(integration, o.finding, o.f);
    externalId = result.externalId;
  } catch (err) {
    errorMsg = (err as Error).message.slice(0, 500);
  }

  return withTenant(o.mspId, async (db) => {
    const id = randomUUID();
    const res = await db.query<StoredRow>(
      `insert into psa_tickets (id, msp_id, client_id, integration_id, finding_key, external_id, summary, status, last_error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id, finding_key) do nothing
       returning *`,
      [id, o.mspId, o.clientId, o.integrationId, o.finding.findingKey, externalId,
       o.finding.summary.slice(0, 500), errorMsg ? "failed" : "open", errorMsg],
    );
    if (res.rowCount === 0) {
      // Someone raced us; return the row they wrote.
      const row = (await db.query<StoredRow>(
        "select * from psa_tickets where client_id = $1 and finding_key = $2",
        [o.clientId, o.finding.findingKey],
      )).rows[0];
      return storedRowTo(row);
    }
    if (errorMsg) throw new PsaError(errorMsg, 502);
    return storedRowTo(res.rows[0]);
  });
}

interface StoredRow {
  id: string;
  client_id: string;
  integration_id: string;
  finding_key: string;
  external_id: string;
  summary: string;
  status: "open" | "closed" | "failed";
  last_error: string;
  created_at: Date;
}
function storedRowTo(r: StoredRow): StoredTicket {
  return {
    id: r.id, clientId: r.client_id, integrationId: r.integration_id,
    findingKey: r.finding_key, externalId: r.external_id, summary: r.summary,
    status: r.status, lastError: r.last_error ?? "", createdAt: r.created_at.toISOString(),
  };
}

/** All tickets for an MSP, newest first. */
export async function listTickets(mspId: string, clientId?: string, limit = 100): Promise<StoredTicket[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  return withTenant(mspId, async (db) =>
    (await db.query<StoredRow>(
      `select * from psa_tickets where ($1::uuid is null or client_id = $1)
         order by created_at desc limit $2`,
      [clientId && isUuid(clientId) ? clientId : null, safeLimit],
    )).rows.map(storedRowTo),
  );
}
