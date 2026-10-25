// Public pulse: aggregate counters for the free /check tool, read by /live.
// Writes go through a SECURITY DEFINER function so the app role only ever
// bumps counts; it can't read other tables through this path. Reads skip the
// tenant guard because the data is intentionally public.

import { getPool, hasDatabase } from "./db.ts";

const BUCKETS = new Set<string>(["check_run", "share_viewed", "share_created"]);
const grade = /^grade:[ABCDF]$/;

export function isValidBucket(b: string): boolean {
  return BUCKETS.has(b) || grade.test(b);
}

export async function bump(buckets: string[], delta = 1): Promise<void> {
  if (!hasDatabase() || buckets.length === 0) return;
  const db = await getPool().connect();
  try {
    for (const b of buckets) {
      if (!isValidBucket(b)) continue;
      await db.query("select pulse_bump($1, $2)", [b, delta]);
    }
  } finally {
    db.release();
  }
}

export interface Pulse {
  totals: Record<string, number>;
  grades: Record<string, number>;
  dailyChecks: { day: string; count: number }[];
}

/** Reads the public counters. Totals are last 30 days; daily is last 14. */
export async function readPulse(): Promise<Pulse> {
  const empty: Pulse = { totals: {}, grades: {}, dailyChecks: [] };
  if (!hasDatabase()) return empty;
  const db = await getPool().connect();
  try {
    const rows = (
      await db.query<{ bucket: string; count: string }>(
        "select bucket, sum(count)::bigint as count from public_pulse where day > current_date - 30 group by bucket",
      )
    ).rows;
    const totals: Record<string, number> = {};
    const grades: Record<string, number> = {};
    for (const r of rows) {
      const n = Number(r.count);
      if (r.bucket.startsWith("grade:")) grades[r.bucket.slice(6)] = n;
      else totals[r.bucket] = n;
    }
    const daily = (
      await db.query<{ day: string; count: string }>(
        "select to_char(day, 'YYYY-MM-DD') as day, sum(count)::bigint as count from public_pulse where bucket = 'check_run' and day > current_date - 14 group by day order by day",
      )
    ).rows;
    return { totals, grades, dailyChecks: daily.map((r) => ({ day: r.day, count: Number(r.count) })) };
  } finally {
    db.release();
  }
}
