// Fires every scheduled client report whose next_run_at has passed.
// Called once an hour by Vercel Cron (vercel.json), and as a maintenance
// task on Docker installs:
//   DATABASE_ADMIN_URL=postgres://owner... DATABASE_URL=postgres://zinloop_app... npm run mail:schedules

import { fileURLToPath } from "node:url";
import { closePool } from "../lib/db.ts";
import { runDueSchedules } from "../lib/schedules.ts";
import { recordRun } from "./job-runs.ts";

export async function fireDueSchedules(adminUrl: string, now = new Date()): Promise<{ ran: number; queued: number }> {
  return runDueSchedules(adminUrl, now);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl || !process.env.DATABASE_URL) {
    console.error("Set DATABASE_ADMIN_URL (owner) and DATABASE_URL (app role).");
    process.exit(1);
  }
  fireDueSchedules(adminUrl)
    .then(async (r) => {
      console.log(`Ran ${r.ran} schedules, queued ${r.queued} emails.`);
      await recordRun(adminUrl, "schedules");
    })
    .catch(async (err) => {
      console.error(err.message);
      await recordRun(adminUrl, "schedules", err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
