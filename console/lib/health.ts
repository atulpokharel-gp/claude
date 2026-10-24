// Health checks for /api/health: is the database reachable, and are the
// background jobs (maintenance, email, backups) still running and succeeding?

import { getPool, hasDatabase } from "./db.ts";

export type JobState = "ok" | "late" | "failing";

/** How long each job may go without succeeding before it counts as late. */
export const JOB_MAX_AGE_MINUTES: Record<string, number> = {
  cleanup: 26 * 60,
  m365_sync: 26 * 60,
  snapshot: 26 * 60,
  mail_weekly: 26 * 60,
  backup: 26 * 60,
  mail_send: 20,
};

export interface JobRow {
  job: string;
  last_ok_at: Date | null;
  last_err_at: Date | null;
}

/** A job is failing when its last run failed, late when it hasn't succeeded recently. Jobs that never ran aren't listed. */
export function jobStates(rows: JobRow[], now = new Date()): Record<string, JobState> {
  const out: Record<string, JobState> = {};
  for (const r of rows) {
    const max = JOB_MAX_AGE_MINUTES[r.job];
    if (max === undefined) continue;
    const ok = r.last_ok_at?.getTime() ?? 0;
    const err = r.last_err_at?.getTime() ?? 0;
    if (err > ok) out[r.job] = "failing";
    else if (now.getTime() - ok > max * 60_000) out[r.job] = "late";
    else out[r.job] = "ok";
  }
  return out;
}

export interface Health {
  ok: boolean;
  database: "ok" | "down" | "not configured";
  jobs?: Record<string, JobState>;
}

export async function checkHealth(withJobs: boolean, now = new Date()): Promise<Health> {
  if (!hasDatabase()) return { ok: true, database: "not configured" };
  try {
    const pool = getPool();
    await pool.query("select 1");
    if (!withJobs) return { ok: true, database: "ok" };
    const jobs = jobStates((await pool.query<JobRow>("select * from job_health()")).rows, now);
    return { ok: Object.values(jobs).every((s) => s === "ok"), database: "ok", jobs };
  } catch {
    return { ok: false, database: "down" };
  }
}
