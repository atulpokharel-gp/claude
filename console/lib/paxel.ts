// Paxel: AI coding habits profiler.
//
// Ingests per-day usage buckets uploaded by the scanner's `zinloop paxel`
// subcommand and computes personal and company-wide rollups. No prompts,
// no code, no file paths — only counts and labels.

import { lookup, withTenant, type Tenant } from "./db.ts";
import { tokenHash } from "./secrets.ts";

export const KNOWN_TOOLS = ["claude-code", "codex", "aider", "cursor", "copilot"] as const;
export type Tool = (typeof KNOWN_TOOLS)[number];

/** Maximum body size we accept for a Paxel upload. */
export const MAX_PAXEL_BYTES = 2 * 1024 * 1024;

/** Maximum rows per upload — enough for several months of per-session rows. */
export const MAX_BUCKETS_PER_UPLOAD = 5_000;

const TOKEN_RE = /^(zlu|agu)_[A-Za-z0-9_-]{32,64}$/;
const HASH_RE = /^[0-9a-f]{16,64}$/;

export class PaxelError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The shape the scanner uploads. */
export interface PaxelUpload {
  hostname: string;
  os?: string;
  scannedAt?: string;
  buckets: PaxelBucket[];
}

export interface PaxelBucket {
  tool: string;
  userHash: string;
  userLabel?: string;
  projectHash: string;
  projectLabel?: string;
  model?: string;
  sessionId?: string;
  day: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsdCents?: number;
  messages?: number;
}

function trim(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function nonneg(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  // Cap at a value that stays inside PG bigint; nobody will burn 2^53 tokens.
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER);
}

function parseDay(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * Validates and normalises a Paxel upload. Throws PaxelError on bad shape.
 * Returns a bucket list ready for the insert.
 */
export function parseUpload(raw: unknown): { hostname: string; os: string; buckets: NormalBucket[] } {
  if (!raw || typeof raw !== "object") throw new PaxelError("Body must be a JSON object.");
  const r = raw as Record<string, unknown>;
  const hostname = trim(r.hostname, 255);
  if (!hostname) throw new PaxelError("Upload has no hostname.");
  const os = trim(r.os, 50);
  const bucketsRaw = r.buckets;
  if (!Array.isArray(bucketsRaw)) throw new PaxelError("buckets must be an array.");
  if (bucketsRaw.length > MAX_BUCKETS_PER_UPLOAD) {
    throw new PaxelError(`Too many buckets (max ${MAX_BUCKETS_PER_UPLOAD}).`);
  }
  const buckets: NormalBucket[] = [];
  for (const b of bucketsRaw) {
    const n = normaliseBucket(b);
    if (n) buckets.push(n);
  }
  return { hostname, os, buckets };
}

export interface NormalBucket {
  tool: string;
  userHash: string;
  userLabel: string;
  projectHash: string;
  projectLabel: string;
  model: string;
  sessionId: string;
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdCents: number;
  messages: number;
}

function normaliseBucket(b: unknown): NormalBucket | null {
  if (!b || typeof b !== "object") return null;
  const r = b as Record<string, unknown>;
  const tool = trim(r.tool, 32).toLowerCase();
  if (!tool) return null;
  const userHash = trim(r.userHash, 64).toLowerCase();
  const projectHash = trim(r.projectHash, 64).toLowerCase();
  if (!HASH_RE.test(userHash) || !HASH_RE.test(projectHash)) return null;
  const day = parseDay(r.day);
  if (!day) return null;
  // Drop zero-usage buckets: no numbers to show, not worth a row.
  const inputTokens = nonneg(r.inputTokens);
  const outputTokens = nonneg(r.outputTokens);
  const cacheReadTokens = nonneg(r.cacheReadTokens);
  const cacheWriteTokens = nonneg(r.cacheWriteTokens);
  const costUsdCents = nonneg(r.costUsdCents);
  const messages = nonneg(r.messages);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + messages === 0) return null;
  return {
    tool,
    userHash,
    userLabel: trim(r.userLabel, 120),
    projectHash,
    projectLabel: trim(r.projectLabel, 200),
    model: trim(r.model, 80),
    sessionId: trim(r.sessionId, 80),
    day,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsdCents,
    messages,
  };
}

/**
 * Writes a Paxel upload against the token's MSP/client. Creates the device if
 * missing (same hostname rule as scans), upserts each bucket, and returns the
 * device id and how many rows were new.
 */
export async function ingestPaxel(
  token: string | undefined,
  raw: unknown,
  now = new Date(),
): Promise<{ deviceId: string; inserted: number; updated: number }> {
  if (!token || !TOKEN_RE.test(token)) throw new PaxelError("Missing or malformed upload token.", 401);
  const owner = await lookup<{ client_id: string; msp_id: string }>(
    "select * from upload_check_token($1)",
    [tokenHash(token)],
  );
  if (!owner) throw new PaxelError("Upload token not recognized or revoked.", 401);
  const { hostname, os, buckets } = parseUpload(raw);
  if (buckets.length === 0) {
    // Nothing to store, but create/update the device so last_seen moves.
    return withTenant(owner.msp_id, async (db) => {
      const device = await upsertDevice(db, owner.msp_id, owner.client_id, hostname, os, now);
      return { deviceId: device, inserted: 0, updated: 0 };
    });
  }

  return withTenant(owner.msp_id, async (db) => {
    const deviceId = await upsertDevice(db, owner.msp_id, owner.client_id, hostname, os, now);
    let inserted = 0;
    let updated = 0;
    for (const b of buckets) {
      const res = await db.query<{ inserted: boolean }>(
        `insert into paxel_usage_events (
           msp_id, client_id, device_id, tool, user_hash, user_label,
           project_hash, project_label, model, bucket_day, session_id,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           cost_usd_cents, messages, first_seen_at, last_seen_at
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, $18
         )
         on conflict (device_id, tool, user_hash, project_hash, model, bucket_day, session_id)
         do update set
           input_tokens       = greatest(paxel_usage_events.input_tokens,       excluded.input_tokens),
           output_tokens      = greatest(paxel_usage_events.output_tokens,      excluded.output_tokens),
           cache_read_tokens  = greatest(paxel_usage_events.cache_read_tokens,  excluded.cache_read_tokens),
           cache_write_tokens = greatest(paxel_usage_events.cache_write_tokens, excluded.cache_write_tokens),
           cost_usd_cents     = greatest(paxel_usage_events.cost_usd_cents,     excluded.cost_usd_cents),
           messages           = greatest(paxel_usage_events.messages,           excluded.messages),
           user_label         = case when excluded.user_label    <> '' then excluded.user_label    else paxel_usage_events.user_label end,
           project_label      = case when excluded.project_label <> '' then excluded.project_label else paxel_usage_events.project_label end,
           last_seen_at       = greatest(paxel_usage_events.last_seen_at, excluded.last_seen_at)
         returning (xmax = 0) as inserted`,
        [
          owner.msp_id,
          owner.client_id,
          deviceId,
          b.tool,
          b.userHash,
          b.userLabel,
          b.projectHash,
          b.projectLabel,
          b.model,
          b.day,
          b.sessionId,
          b.inputTokens,
          b.outputTokens,
          b.cacheReadTokens,
          b.cacheWriteTokens,
          b.costUsdCents,
          b.messages,
          now,
        ],
      );
      if (res.rows[0]?.inserted) inserted++;
      else updated++;
    }
    return { deviceId, inserted, updated };
  });
}

async function upsertDevice(
  db: import("pg").PoolClient,
  mspId: string,
  clientId: string,
  hostname: string,
  os: string,
  now: Date,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into devices (msp_id, client_id, hostname, os, last_scan_at)
     values ($1, $2, $3, $4, $5)
     on conflict (client_id, hostname) do update set
       os = case when excluded.os <> '' then excluded.os else devices.os end,
       last_scan_at = greatest(devices.last_scan_at, excluded.last_scan_at)
     returning id`,
    [mspId, clientId, hostname, os, now],
  );
  return r.rows[0].id;
}

// --- rollups ---------------------------------------------------------------

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdCents: number;
  messages: number;
}

const zeroTotals: Totals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsdCents: 0,
  messages: 0,
};

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsdCents: a.costUsdCents + b.costUsdCents,
    messages: a.messages + b.messages,
  };
}

/** Grand total tokens: input + output + cache (either direction). */
export function allTokens(t: Totals): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}

export interface GroupTotal<K> {
  key: K;
  label: string;
  totals: Totals;
}

export interface DayTotal {
  day: string;
  totals: Totals;
}

export interface Rollup {
  totals: Totals;
  byTool: GroupTotal<string>[];
  byProject: GroupTotal<string>[];
  byUser: GroupTotal<string>[];
  byDay: DayTotal[];
}

interface Row {
  tool: string;
  user_hash: string;
  user_label: string;
  project_hash: string;
  project_label: string;
  model: string;
  bucket_day: Date | string;
  input_tokens: string | number;
  output_tokens: string | number;
  cache_read_tokens: string | number;
  cache_write_tokens: string | number;
  cost_usd_cents: string | number;
  messages: string | number;
}

function rowTotals(r: Row): Totals {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheReadTokens: Number(r.cache_read_tokens),
    cacheWriteTokens: Number(r.cache_write_tokens),
    costUsdCents: Number(r.cost_usd_cents),
    messages: Number(r.messages),
  };
}

function dayKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Builds a rollup from raw rows. Pure, so tests can drive it. */
export function rollup(rows: Row[], limit = 50): Rollup {
  let totals: Totals = { ...zeroTotals };
  const tool = new Map<string, Totals>();
  const project = new Map<string, { label: string; totals: Totals }>();
  const user = new Map<string, { label: string; totals: Totals }>();
  const day = new Map<string, Totals>();

  for (const r of rows) {
    const t = rowTotals(r);
    totals = addTotals(totals, t);
    tool.set(r.tool, addTotals(tool.get(r.tool) ?? zeroTotals, t));

    const pKey = r.project_hash;
    const pPrev = project.get(pKey);
    project.set(pKey, {
      // Prefer any non-empty label we've seen. Fall back to shortHash only
      // when every row for this project came in without one.
      label: pickLabel(pPrev?.label, r.project_label, () => shortHash(r.project_hash)),
      totals: addTotals(pPrev?.totals ?? zeroTotals, t),
    });

    const uKey = r.user_hash;
    const uPrev = user.get(uKey);
    user.set(uKey, {
      label: pickLabel(uPrev?.label, r.user_label, () => shortHash(r.user_hash)),
      totals: addTotals(uPrev?.totals ?? zeroTotals, t),
    });

    const dKey = dayKey(r.bucket_day);
    day.set(dKey, addTotals(day.get(dKey) ?? zeroTotals, t));
  }

  const byTool: GroupTotal<string>[] = [...tool.entries()]
    .map(([k, v]) => ({ key: k, label: k, totals: v }))
    .sort((a, b) => allTokens(b.totals) - allTokens(a.totals));
  const byProject: GroupTotal<string>[] = [...project.entries()]
    .map(([k, v]) => ({ key: k, label: v.label, totals: v.totals }))
    .sort((a, b) => allTokens(b.totals) - allTokens(a.totals))
    .slice(0, limit);
  const byUser: GroupTotal<string>[] = [...user.entries()]
    .map(([k, v]) => ({ key: k, label: v.label, totals: v.totals }))
    .sort((a, b) => allTokens(b.totals) - allTokens(a.totals))
    .slice(0, limit);
  const byDay: DayTotal[] = [...day.entries()]
    .map(([k, v]) => ({ day: k, totals: v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return { totals, byTool, byProject, byUser, byDay };
}

function shortHash(h: string): string {
  return h.length <= 10 ? h : `${h.slice(0, 8)}…`;
}

/** First non-empty label wins; prior label is kept over a fallback. */
function pickLabel(prev: string | undefined, next: string, fallback: () => string): string {
  if (next) return next;
  if (prev && !prev.endsWith("…")) return prev;
  return prev || fallback();
}

/** Loads a company-wide rollup for the signed-in MSP over the past N days. */
export async function companyRollup(tenant: Tenant, days = 30, now = new Date()): Promise<Rollup> {
  const since = sinceDay(days, now);
  return withTenant(tenant, async (db) => {
    const rows = (
      await db.query<Row>(
        `select tool, user_hash, user_label, project_hash, project_label, model,
                bucket_day, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, cost_usd_cents, messages
         from paxel_usage_events
         where bucket_day >= $1`,
        [since],
      )
    ).rows;
    return rollup(rows);
  });
}

/** Loads one developer's rollup, keyed by user_hash. */
export async function userRollup(
  tenant: Tenant,
  userHash: string,
  days = 30,
  now = new Date(),
): Promise<Rollup> {
  if (!HASH_RE.test(userHash)) throw new PaxelError("Invalid user hash.");
  const since = sinceDay(days, now);
  return withTenant(tenant, async (db) => {
    const rows = (
      await db.query<Row>(
        `select tool, user_hash, user_label, project_hash, project_label, model,
                bucket_day, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, cost_usd_cents, messages
         from paxel_usage_events
         where user_hash = $1 and bucket_day >= $2`,
        [userHash, since],
      )
    ).rows;
    return rollup(rows);
  });
}

function sinceDay(days: number, now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - Math.max(1, days) + 1);
  return d.toISOString().slice(0, 10);
}

/** Formats a token count: 1_234 -> "1.2K", 1_234_567 -> "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Formats cents as a USD dollar amount. */
export function fmtUsd(cents: number): string {
  const d = cents / 100;
  if (d < 1_000) return `$${d.toFixed(2)}`;
  return `$${d.toFixed(0)}`;
}
