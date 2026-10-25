// Background jobs for hosts without a long-running worker (Vercel). Vercel
// calls /api/cron/* on the schedule in vercel.json and sends
// "Authorization: Bearer $CRON_SECRET". Docker installs keep using the
// maintenance container instead, and these routes stay switched off there.

import { timingSafeEqual } from "node:crypto";
import { recordRun } from "../scripts/job-runs.ts";

/** True only when CRON_SECRET is set and the request carries it. */
export function cronAuthorized(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Runs one job and records the result for /api/health?jobs=1. Never throws. */
export async function runJob(adminUrl: string, name: string, fn: () => Promise<unknown>): Promise<{ job: string; ok: boolean; result?: unknown; error?: string }> {
  try {
    const result = await fn();
    await recordRun(adminUrl, name);
    return { job: name, ok: true, result };
  } catch (err) {
    console.error(`${name} failed: ${(err as Error).message}`);
    await recordRun(adminUrl, name, err);
    return { job: name, ok: false, error: String((err as Error).message ?? err).slice(0, 200) };
  }
}
