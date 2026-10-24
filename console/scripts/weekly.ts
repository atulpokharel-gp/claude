// Queues the weekly summary emails. Safe to run daily: each person gets one per
// week (Monday to Sunday, UTC), on the first run of that week.
//   DATABASE_ADMIN_URL=postgres://owner... DATABASE_URL=postgres://zinloop_app... npm run mail:weekly

import { fileURLToPath } from "node:url";
import pg from "pg";
import { queueWeekly } from "../lib/alerts.ts";
import { closePool } from "../lib/db.ts";

export async function queueAllWeekly(adminUrl: string, now = new Date()): Promise<number> {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  let msps: string[];
  try {
    msps = (await db.query<{ id: string }>("select id from msps order by created_at")).rows.map((r) => r.id);
  } finally {
    await db.end();
  }
  let n = 0;
  for (const id of msps) {
    try {
      n += await queueWeekly(id, now);
    } catch (err) {
      // One MSP's bad data shouldn't stop everyone else's summary.
      console.error(`weekly summary for MSP ${id} failed: ${(err as Error).message}`);
    }
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl || !process.env.DATABASE_URL) {
    console.error("Set DATABASE_ADMIN_URL (owner) and DATABASE_URL (app role).");
    process.exit(1);
  }
  queueAllWeekly(adminUrl)
    .then((n) => console.log(`Queued ${n} weekly summary emails.`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
