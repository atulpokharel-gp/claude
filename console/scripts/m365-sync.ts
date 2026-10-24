// Re-checks every connected Microsoft 365 tenant. Run daily next to db:cleanup:
//   DATABASE_ADMIN_URL=postgres://owner... DATABASE_URL=postgres://zinloop_app... npm run m365:sync

import { fileURLToPath } from "node:url";
import pg from "pg";
import { recordRun } from "./job-runs.ts";
import { closePool } from "../lib/db.ts";
import { syncM365 } from "../lib/store.ts";

export async function syncAll(adminUrl: string, log = console.log): Promise<{ ok: number; failed: number }> {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  let rows: { msp_id: string; client_id: string }[];
  try {
    rows = (await db.query<{ msp_id: string; client_id: string }>("select msp_id, client_id from m365_tenants")).rows;
  } finally {
    await db.end();
  }
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await syncM365(r.msp_id, r.client_id);
    if ("error" in res) {
      failed++;
      log(`client ${r.client_id}: ${res.error}`);
    } else ok++;
  }
  return { ok, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl || !process.env.DATABASE_URL) {
    console.error("Set DATABASE_ADMIN_URL (owner) and DATABASE_URL (app role).");
    process.exit(1);
  }
  syncAll(adminUrl)
    .then(async ({ ok, failed }) => {
      console.log(`Checked ${ok} tenants, ${failed} failed.`);
      // One tenant's error is shown on its client page; the job itself still ran.
      await recordRun(adminUrl, "m365_sync");
    })
    .catch(async (err) => {
      console.error(err.message);
      await recordRun(adminUrl, "m365_sync", err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
