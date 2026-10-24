// Deletes expired sessions, used-up invites, old rate-limit records, and scans
// older than SCAN_KEEP_DAYS (default 90) except each laptop's newest. Run daily:
//   DATABASE_ADMIN_URL=postgres://... npm run db:cleanup

import { fileURLToPath } from "node:url";
import pg from "pg";

export async function cleanup(url: string, keepDays = 90) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const r = await db.query<{ sessions: string; invites: string; rate_limits: string; scans: string }>(
      "select * from cleanup_expired($1)",
      [keepDays],
    );
    const row = r.rows[0];
    return {
      sessions: Number(row.sessions),
      invites: Number(row.invites),
      rateLimits: Number(row.rate_limits),
      scans: Number(row.scans),
    };
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error("Set DATABASE_ADMIN_URL to an owner connection string.");
    process.exit(1);
  }
  cleanup(url, Number(process.env.SCAN_KEEP_DAYS) || 90)
    .then((n) => console.log(`Deleted ${n.sessions} sessions, ${n.invites} invites, ${n.rateLimits} rate-limit records, ${n.scans} old scans.`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
