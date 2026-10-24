// Records that a background job finished, for /api/health. Never throws: a
// failure to record must not hide the job's own result.

import pg from "pg";

export async function recordRun(adminUrl: string, job: string, error?: unknown): Promise<void> {
  const db = new pg.Client({ connectionString: adminUrl });
  try {
    await db.connect();
    if (error === undefined) {
      await db.query(
        `insert into job_runs (job, last_ok_at) values ($1, now())
         on conflict (job) do update set last_ok_at = now()`,
        [job],
      );
    } else {
      const msg = String((error as Error)?.message ?? error).slice(0, 500);
      await db.query(
        `insert into job_runs (job, last_err_at, last_error) values ($1, now(), $2)
         on conflict (job) do update set last_err_at = now(), last_error = excluded.last_error`,
        [job, msg],
      );
    }
  } catch (err) {
    console.error(`couldn't record the ${job} run: ${(err as Error).message}`);
  } finally {
    await db.end().catch(() => {});
  }
}
