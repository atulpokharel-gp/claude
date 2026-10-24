// Saves today's risk counts for every client (so the trend chart has a point
// each day even without new scans) and trims snapshots older than ~13 months.
// Run daily after m365:sync:
//   DATABASE_ADMIN_URL=postgres://owner... DATABASE_URL=postgres://zinloop_app... npm run db:snapshot

import { fileURLToPath } from "node:url";
import pg from "pg";
import { closePool } from "../lib/db.ts";
import { snapshotClient } from "../lib/store.ts";

export async function snapshotAll(adminUrl: string, now = new Date(), keepDays = 400): Promise<number> {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  let rows: { id: string; msp_id: string }[];
  try {
    rows = (await db.query<{ id: string; msp_id: string }>("select id, msp_id from clients")).rows;
    await db.query("delete from risk_snapshots where day < $1::date - $2::int", [now.toISOString().slice(0, 10), keepDays]);
  } finally {
    await db.end();
  }
  for (const r of rows) await snapshotClient(r.msp_id, r.id, now);
  return rows.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl || !process.env.DATABASE_URL) {
    console.error("Set DATABASE_ADMIN_URL (owner) and DATABASE_URL (app role).");
    process.exit(1);
  }
  snapshotAll(adminUrl)
    .then((n) => console.log(`Saved risk counts for ${n} clients.`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
