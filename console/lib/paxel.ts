// Paxel: AI coding habits profiler.
//
// Ingests per-day usage buckets uploaded by the scanner's `zinloop paxel`
// subcommand and computes personal and company-wide rollups. No prompts,
// no code, no file paths — only counts and labels.

import { createHash, randomBytes } from "node:crypto";
import { getPool, lookup, withTenant, type Tenant } from "./db.ts";
import { tokenHash } from "./secrets.ts";
import { sign, verifySigned } from "./crypto.ts";

export const KNOWN_TOOLS = ["claude-code", "codex", "aider", "cursor", "copilot"] as const;
export type Tool = (typeof KNOWN_TOOLS)[number];

/** The five builder-profile dimensions. Keep in sync with scanner/internal/paxel/profile.go. */
export const DIMENSIONS = [
  "steering",
  "execution",
  "engineering",
  "product-instinct",
  "planning",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const DIMENSION_SET = new Set<string>(DIMENSIONS);

export const DIMENSION_LABEL: Record<Dimension, string> = {
  steering: "Steering",
  execution: "Execution",
  engineering: "Engineering",
  "product-instinct": "Product instinct",
  planning: "Planning",
};

export const DIMENSION_BLURB: Record<Dimension, string> = {
  steering: "How specifically you direct the AI — specific prompts, few corrections, right prompt-to-tool ratio.",
  execution: "How much the session ships — tool use density, writes over reads, length.",
  engineering: "Care for tests, lint and typecheck runs, refactor-shape edits.",
  "product-instinct": "Attention to users — docs, UI, and API edits over internals-only work.",
  planning: "Breaking work down before diving in — long opening prompt, TODO lists, TodoWrite use.",
};

/** Maximum body size we accept for a Paxel upload. */
export const MAX_PAXEL_BYTES = 2 * 1024 * 1024;

/** Maximum rows per upload — enough for several months of per-session rows. */
export const MAX_BUCKETS_PER_UPLOAD = 5_000;

/** Maximum profile rows per upload. */
export const MAX_PROFILES_PER_UPLOAD = 2_500;

/** Max keys we store in the metrics bag (per row). */
export const MAX_METRIC_KEYS = 32;

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
  profiles?: PaxelProfile[];
  claim?: PaxelClaim;
}

export interface PaxelClaim {
  userHash: string;
  claimToken: string; // base64url, >= 32 bytes
}

export interface PaxelProfile {
  tool: string;
  userHash: string;
  userLabel?: string;
  projectHash: string;
  projectLabel?: string;
  dimension: string;
  day: string;
  score: number;
  sessions?: number;
  metrics?: Record<string, number>;
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
 * Returns bucket and profile lists ready for the insert.
 */
export function parseUpload(raw: unknown): {
  hostname: string;
  os: string;
  buckets: NormalBucket[];
  profiles: NormalProfile[];
  claim: NormalClaim | null;
} {
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
  const profilesRaw = r.profiles;
  const profiles: NormalProfile[] = [];
  if (Array.isArray(profilesRaw)) {
    if (profilesRaw.length > MAX_PROFILES_PER_UPLOAD) {
      throw new PaxelError(`Too many profile rows (max ${MAX_PROFILES_PER_UPLOAD}).`);
    }
    for (const p of profilesRaw) {
      const n = normaliseProfile(p);
      if (n) profiles.push(n);
    }
  }
  const claim = normaliseClaim(r.claim);
  return { hostname, os, buckets, profiles, claim };
}

function normaliseClaim(c: unknown): NormalClaim | null {
  if (!c || typeof c !== "object") return null;
  const r = c as Record<string, unknown>;
  const userHash = trim(r.userHash, 64).toLowerCase();
  if (!HASH_RE.test(userHash)) return null;
  const token = trim(r.claimToken, 128);
  // base64url, 43+ chars → >= 32 bytes.
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return null;
  return { userHash, claimToken: token };
}

export interface NormalClaim {
  userHash: string;
  claimToken: string;
}

export interface NormalProfile {
  tool: string;
  userHash: string;
  userLabel: string;
  projectHash: string;
  projectLabel: string;
  dimension: string;
  day: string;
  score: number;
  sessions: number;
  metrics: Record<string, number>;
}

function normaliseProfile(p: unknown): NormalProfile | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  const tool = trim(r.tool, 32).toLowerCase();
  if (!tool) return null;
  const userHash = trim(r.userHash, 64).toLowerCase();
  const projectHash = trim(r.projectHash, 64).toLowerCase();
  if (!HASH_RE.test(userHash) || !HASH_RE.test(projectHash)) return null;
  const dimension = trim(r.dimension, 32).toLowerCase();
  if (!DIMENSION_SET.has(dimension)) return null;
  const day = parseDay(r.day);
  if (!day) return null;
  let score = 0;
  if (typeof r.score === "number" && Number.isFinite(r.score)) {
    score = Math.round(r.score);
    if (score < 0) score = 0;
    if (score > 100) score = 100;
  } else {
    return null;
  }
  const sessions = Math.max(1, nonneg(r.sessions ?? 1));
  const metrics: Record<string, number> = {};
  if (r.metrics && typeof r.metrics === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(r.metrics as Record<string, unknown>)) {
      if (n >= MAX_METRIC_KEYS) break;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
      const key = String(k).slice(0, 40);
      metrics[key] = Math.min(Math.floor(v), 1_000_000_000);
      n++;
    }
  }
  return {
    tool,
    userHash,
    userLabel: trim(r.userLabel, 120),
    projectHash,
    projectLabel: trim(r.projectLabel, 200),
    dimension,
    day,
    score,
    sessions,
    metrics,
  };
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
): Promise<{ deviceId: string; inserted: number; updated: number; profileRows: number }> {
  if (!token || !TOKEN_RE.test(token)) throw new PaxelError("Missing or malformed upload token.", 401);
  const owner = await lookup<{ client_id: string; msp_id: string }>(
    "select * from upload_check_token($1)",
    [tokenHash(token)],
  );
  if (!owner) throw new PaxelError("Upload token not recognized or revoked.", 401);
  const { hostname, os, buckets, profiles, claim } = parseUpload(raw);
  if (buckets.length === 0 && profiles.length === 0 && !claim) {
    // Nothing to store, but create/update the device so last_seen moves.
    return withTenant(owner.msp_id, async (db) => {
      const device = await upsertDevice(db, owner.msp_id, owner.client_id, hostname, os, now);
      return { deviceId: device, inserted: 0, updated: 0, profileRows: 0 };
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
    let profileRows = 0;
    for (const p of profiles) {
      await db.query(
        `insert into paxel_profile_scores (
           msp_id, client_id, device_id, tool, user_hash, user_label,
           project_hash, project_label, dimension, bucket_day, score,
           sessions, metrics, first_seen_at, last_seen_at
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13::jsonb, $14, $14
         )
         on conflict (device_id, tool, user_hash, project_hash, dimension, bucket_day)
         do update set
           score        = excluded.score,
           sessions     = greatest(paxel_profile_scores.sessions, excluded.sessions),
           user_label   = case when excluded.user_label    <> '' then excluded.user_label    else paxel_profile_scores.user_label end,
           project_label = case when excluded.project_label <> '' then excluded.project_label else paxel_profile_scores.project_label end,
           metrics      = excluded.metrics,
           last_seen_at = greatest(paxel_profile_scores.last_seen_at, excluded.last_seen_at)`,
        [
          owner.msp_id,
          owner.client_id,
          deviceId,
          p.tool,
          p.userHash,
          p.userLabel,
          p.projectHash,
          p.projectLabel,
          p.dimension,
          p.day,
          p.score,
          p.sessions,
          JSON.stringify(p.metrics),
          now,
        ],
      );
      profileRows++;
    }
    if (claim) {
      // Hash the claim token the same way upload tokens are hashed.
      const h = createHash("sha256").update(claim.claimToken).digest();
      // On conflict (user_hash primary key) refresh the hash and the
      // (msp_id, client_id) binding so a device re-install rebinds, but
      // only within the same tenant: a different tenant's user_hash
      // cannot be moved because RLS filters by current_msp.
      await db.query(
        `insert into paxel_user_claims (user_hash, msp_id, client_id, claim_hash)
         values ($1, $2, $3, $4)
         on conflict (user_hash) do update set
           msp_id     = excluded.msp_id,
           client_id  = excluded.client_id,
           claim_hash = excluded.claim_hash`,
        [claim.userHash, owner.msp_id, owner.client_id, h],
      );
    }
    return { deviceId, inserted, updated, profileRows };
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

// --- profile rollups -------------------------------------------------------

export interface DimensionAggregate {
  dimension: Dimension;
  score: number; // 0-100, averaged across days and projects
  sessions: number;
  days: number;
  metrics: Record<string, number>;
}

export interface ProfileReading {
  userHash: string;
  userLabel: string;
  dims: DimensionAggregate[];
}

interface ProfileRow {
  user_hash: string;
  user_label: string;
  dimension: string;
  bucket_day: Date | string;
  score: number;
  sessions: number;
  metrics: Record<string, number> | string;
}

function emptyDim(d: Dimension): DimensionAggregate {
  return { dimension: d, score: 0, sessions: 0, days: 0, metrics: {} };
}

function rollupProfile(rows: ProfileRow[]): ProfileReading | null {
  if (rows.length === 0) return null;
  const dims = new Map<Dimension, { total: number; weight: number; sessions: number; days: Set<string>; metrics: Record<string, number> }>();
  let userLabel = "";
  const userHash = rows[0].user_hash;
  for (const r of rows) {
    const d = r.dimension as Dimension;
    if (!DIMENSION_SET.has(d)) continue;
    if (r.user_label && !userLabel) userLabel = r.user_label;
    let m = dims.get(d);
    if (!m) {
      m = { total: 0, weight: 0, sessions: 0, days: new Set<string>(), metrics: {} };
      dims.set(d, m);
    }
    const sess = r.sessions || 1;
    m.total += Number(r.score) * sess;
    m.weight += sess;
    m.sessions += sess;
    m.days.add(typeof r.bucket_day === "string" ? r.bucket_day.slice(0, 10) : r.bucket_day.toISOString().slice(0, 10));
    const metrics = typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics ?? {};
    for (const [k, v] of Object.entries(metrics)) {
      m.metrics[k] = (m.metrics[k] ?? 0) + Number(v);
    }
  }
  const out: DimensionAggregate[] = DIMENSIONS.map((d) => {
    const m = dims.get(d);
    if (!m || m.weight === 0) return emptyDim(d);
    return {
      dimension: d,
      score: Math.round(m.total / m.weight),
      sessions: m.sessions,
      days: m.days.size,
      metrics: m.metrics,
    };
  });
  return { userHash, userLabel: userLabel || shortHash(userHash), dims: out };
}

/** One developer's full profile reading over the last N days. */
export async function userProfile(
  tenant: Tenant,
  userHash: string,
  days = 30,
  now = new Date(),
): Promise<ProfileReading | null> {
  if (!HASH_RE.test(userHash)) throw new PaxelError("Invalid user hash.");
  const since = sinceDay(days, now);
  return withTenant(tenant, async (db) => {
    const rows = (
      await db.query<ProfileRow>(
        `select user_hash, user_label, dimension, bucket_day, score, sessions, metrics
           from paxel_profile_scores
           where user_hash = $1 and bucket_day >= $2`,
        [userHash, since],
      )
    ).rows;
    return rollupProfile(rows);
  });
}

/** Anonymous team-wide averages: no names, no individual rows. */
export async function teamProfile(
  tenant: Tenant,
  days = 30,
  now = new Date(),
): Promise<{ dims: DimensionAggregate[]; developers: number }> {
  const since = sinceDay(days, now);
  return withTenant(tenant, async (db) => {
    const rows = (
      await db.query<{
        dimension: string;
        avg_score: string;
        sessions: string;
        developers: string;
      }>(
        `select dimension, avg(score)::float as avg_score, sum(sessions)::bigint as sessions, count(distinct user_hash) as developers
           from paxel_profile_scores
           where bucket_day >= $1
           group by dimension`,
        [since],
      )
    ).rows;
    const dimMap = new Map(rows.map((r) => [r.dimension, r]));
    const developers = rows.reduce((n, r) => Math.max(n, Number(r.developers)), 0);
    const dims: DimensionAggregate[] = DIMENSIONS.map((d) => {
      const r = dimMap.get(d);
      if (!r) return emptyDim(d);
      return {
        dimension: d,
        score: Math.round(Number(r.avg_score)),
        sessions: Number(r.sessions),
        days: 0,
        metrics: {},
      };
    });
    return { dims, developers };
  });
}

// --- public profile prefs --------------------------------------------------

export interface ProfilePrefs {
  mspId: string;
  clientId: string;
  userHash: string;
  displayName: string;
  publicSlug: string | null;
  publicDims: Dimension[];
}

export async function getPrefs(tenant: Tenant, userHash: string): Promise<ProfilePrefs | null> {
  if (!HASH_RE.test(userHash)) return null;
  return withTenant(tenant, async (db) => {
    const r = (
      await db.query<{
        msp_id: string;
        client_id: string;
        user_hash: string;
        display_name: string;
        public_slug: string | null;
        public_dims: string[];
      }>(
        `select msp_id, client_id, user_hash, display_name, public_slug, public_dims
           from paxel_profile_prefs where user_hash = $1`,
        [userHash],
      )
    ).rows[0];
    if (!r) return null;
    return {
      mspId: r.msp_id,
      clientId: r.client_id,
      userHash: r.user_hash,
      displayName: r.display_name,
      publicSlug: r.public_slug,
      publicDims: r.public_dims.filter((d): d is Dimension => DIMENSION_SET.has(d)),
    };
  });
}

const SLUG_RE = /^[a-z0-9]{14,32}$/;

export function newPublicSlug(): string {
  // 14 random base36-ish chars. Avoid i/l/o/0/1 confusion by using the full
  // alphabet; collisions at 14 chars are negligible for this scale.
  const bytes = new Uint8Array(14);
  (globalThis.crypto ?? require("node:crypto").webcrypto).getRandomValues(bytes);
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (const b of bytes) out += alpha[b % alpha.length];
  return out;
}

/** Needs tenant scope; the viewer is one client, so clientId is required. */
export async function savePrefs(
  tenant: { mspId: string; clientId: string },
  userHash: string,
  patch: { displayName?: string; publicSlug?: string | null; publicDims?: Dimension[] },
): Promise<ProfilePrefs> {
  if (!HASH_RE.test(userHash)) throw new PaxelError("Invalid user hash.");
  const displayName = typeof patch.displayName === "string" ? patch.displayName.slice(0, 120) : null;
  let publicSlug: string | null | undefined = patch.publicSlug;
  if (typeof publicSlug === "string") {
    publicSlug = publicSlug.toLowerCase().trim();
    if (publicSlug !== "" && !SLUG_RE.test(publicSlug)) throw new PaxelError("Public slug must be 14-32 lowercase letters/digits.");
    if (publicSlug === "") publicSlug = null;
  }
  const publicDims = (patch.publicDims ?? []).filter((d) => DIMENSION_SET.has(d));
  return withTenant(tenant, async (db) => {
    // Upsert. Keep existing fields when the patch doesn't name them.
    const r = (
      await db.query<{
        msp_id: string;
        client_id: string;
        user_hash: string;
        display_name: string;
        public_slug: string | null;
        public_dims: string[];
      }>(
        `insert into paxel_profile_prefs (msp_id, client_id, user_hash, display_name, public_slug, public_dims)
         values ($1, $2, $3, coalesce($4, ''), $5, $6::text[])
         on conflict (msp_id, user_hash) do update set
           client_id    = excluded.client_id,
           display_name = coalesce($4, paxel_profile_prefs.display_name),
           public_slug  = case when $7::boolean then excluded.public_slug else paxel_profile_prefs.public_slug end,
           public_dims  = case when $8::boolean then excluded.public_dims else paxel_profile_prefs.public_dims end,
           updated_at   = now()
         returning msp_id, client_id, user_hash, display_name, public_slug, public_dims`,
        [
          tenant.mspId,
          tenant.clientId,
          userHash,
          displayName,
          publicSlug ?? null,
          publicDims,
          publicSlug !== undefined,
          patch.publicDims !== undefined,
        ],
      )
    ).rows[0];
    return {
      mspId: r.msp_id,
      clientId: r.client_id,
      userHash: r.user_hash,
      displayName: r.display_name,
      publicSlug: r.public_slug,
      publicDims: r.public_dims.filter((d): d is Dimension => DIMENSION_SET.has(d)),
    };
  });
}

// --- public lookup ---------------------------------------------------------

export interface PublicProfileView {
  displayName: string;
  dims: DimensionAggregate[];
}

/** Reads a public profile by slug. Returns null for unknown or empty. */
export async function readPublicProfile(slug: string, days = 30, now = new Date()): Promise<PublicProfileView | null> {
  if (!SLUG_RE.test(slug)) return null;
  const owner = await lookup<{
    msp_id: string;
    client_id: string;
    user_hash: string;
    display_name: string;
    public_dims: string[];
  }>("select * from paxel_public_profile($1)", [slug]);
  if (!owner) return null;
  const allowed = new Set(owner.public_dims.filter((d) => DIMENSION_SET.has(d)));
  if (allowed.size === 0) return null;
  const reading = await userProfile(owner.msp_id, owner.user_hash, days, now);
  if (!reading) return null;
  return {
    displayName: owner.display_name || reading.userLabel,
    dims: reading.dims.filter((d) => allowed.has(d.dimension)),
  };
}

/** Formats a token count: 1_234 -> "1.2K", 1_234_567 -> "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

// --- claim flow ------------------------------------------------------------

/** Cookie name for a developer identity gained via /paxel/claim. */
export const PAXEL_DEV_COOKIE = "paxel_dev";
const CLAIM_TTL_DAYS = 180;

export interface DevIdentity {
  mspId: string;
  clientId: string;
  userHash: string;
}

/** Resolve a raw claim token to the dev it binds. Returns null for unknown. */
export async function resolveClaim(token: string): Promise<DevIdentity | null> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return null;
  const h = createHash("sha256").update(token).digest();
  const row = await lookup<{ msp_id: string; client_id: string; user_hash: string }>(
    "select * from paxel_resolve_claim($1)",
    [h],
  );
  if (!row) return null;
  // Stamp claimed_at on first claim; doesn't block repeat visits (handy
  // after a wipe), just records when the dev first bound the token.
  await withTenant(row.msp_id, (db) =>
    db.query("update paxel_user_claims set claimed_at = now() where user_hash = $1 and claimed_at is null", [
      row.user_hash,
    ]),
  );
  return { mspId: row.msp_id, clientId: row.client_id, userHash: row.user_hash };
}

/** Signed value stored in the paxel_dev cookie. */
export function signDevIdentity(id: DevIdentity, now = Date.now()): string {
  return sign("paxel_dev", id, CLAIM_TTL_DAYS * 24 * 3600, now);
}

/** Read + verify the signed cookie. Null on anything that doesn't match. */
export function readDevIdentity(token: string | undefined, now = Date.now()): DevIdentity | null {
  return verifySigned<DevIdentity>("paxel_dev", token, now);
}

export function paxelDevCookieMaxAge(): number {
  return CLAIM_TTL_DAYS * 24 * 3600;
}

/** Random token used by the scanner for a laptop. 32 bytes, base64url. */
export function newClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

// --- leaderboards ----------------------------------------------------------

export interface LeaderboardRow {
  userHash: string;
  displayName: string;
  publicSlug: string | null;
  publicDims: Dimension[];
  dimScores: Partial<Record<Dimension, number>>;
  meanScore: number;
  sessions: number;
}

/**
 * Public, cross-tenant leaderboard. Lists only developers who opted into a
 * public profile. Rankings come from the SECURITY DEFINER function
 * paxel_public_leaderboard, which aggregates scores server-side and never
 * returns anything outside what the dev already published on /p/{slug}.
 */
export async function readPublicLeaderboard(days = 30, limit = 100): Promise<LeaderboardRow[]> {
  const rows = (
    await getPool().query<{
      user_hash: string;
      display_name: string;
      public_slug: string | null;
      public_dims: string[];
      dim_scores: Record<string, number> | null;
      mean_score: number;
      sessions_counted: number;
    }>("select * from paxel_public_leaderboard($1, $2)", [days, limit])
  ).rows;
  return rows.map((r) => shapeLeaderboardRow(r));
}

/**
 * Company leaderboard inside one tenant. Shows every developer the viewer
 * is already allowed to see (RLS filters on current_msp / current_client).
 * No opt-in required — this is the internal view the MSP or client pays
 * for. Public prefs are joined in so the UI can link to a dev's public
 * page when one exists.
 */
export async function readCompanyLeaderboard(
  tenant: Tenant,
  days = 30,
  limit = 200,
): Promise<LeaderboardRow[]> {
  const since = sinceDay(days, new Date());
  return withTenant(tenant, async (db) => {
    const rows = (
      await db.query<{
        user_hash: string;
        user_label: string;
        dim_scores: Record<string, number> | null;
        mean_score: number;
        sessions_counted: number;
        public_slug: string | null;
        display_name: string | null;
        public_dims: string[] | null;
      }>(
        `with scored as (
           select user_hash,
                  max(user_label) as user_label,
                  dimension,
                  avg(score)::numeric as score,
                  sum(sessions)::int as sessions
             from paxel_profile_scores
             where bucket_day >= $1
             group by user_hash, dimension
         ),
         per_user as (
           select user_hash,
                  max(user_label) as user_label,
                  coalesce(jsonb_object_agg(dimension, round(score)::int), '{}'::jsonb) as dim_scores,
                  round(avg(score))::int as mean_score,
                  sum(sessions)::int    as sessions_counted
             from scored
             group by user_hash
         )
         select p.user_hash,
                coalesce(pr.display_name, p.user_label, '') as user_label,
                p.dim_scores,
                p.mean_score,
                p.sessions_counted,
                pr.public_slug,
                pr.display_name,
                pr.public_dims
           from per_user p
           left join paxel_profile_prefs pr on pr.user_hash = p.user_hash
          order by p.mean_score desc, p.sessions_counted desc, p.user_hash asc
          limit $2`,
        [since, limit],
      )
    ).rows;
    return rows.map((r) =>
      shapeLeaderboardRow({
        user_hash: r.user_hash,
        display_name: r.display_name || r.user_label || shortHash(r.user_hash),
        public_slug: r.public_slug,
        public_dims: r.public_dims ?? [],
        dim_scores: r.dim_scores,
        mean_score: r.mean_score,
        sessions_counted: r.sessions_counted,
      }),
    );
  });
}

function shapeLeaderboardRow(r: {
  user_hash: string;
  display_name: string;
  public_slug: string | null;
  public_dims: string[];
  dim_scores: Record<string, number> | null;
  mean_score: number;
  sessions_counted: number;
}): LeaderboardRow {
  const dimScores: Partial<Record<Dimension, number>> = {};
  for (const [k, v] of Object.entries(r.dim_scores ?? {})) {
    if (DIMENSION_SET.has(k)) dimScores[k as Dimension] = clampScore(Number(v));
  }
  return {
    userHash: r.user_hash,
    displayName: r.display_name || shortHash(r.user_hash),
    publicSlug: r.public_slug,
    publicDims: (r.public_dims ?? []).filter((d): d is Dimension => DIMENSION_SET.has(d)),
    dimScores,
    meanScore: clampScore(Number(r.mean_score)),
    sessions: Number(r.sessions_counted) || 0,
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Formats cents as a USD dollar amount. */
export function fmtUsd(cents: number): string {
  const d = cents / 100;
  if (d < 1_000) return `$${d.toFixed(2)}`;
  return `$${d.toFixed(0)}`;
}
