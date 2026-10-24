// Runs before `next build` on Vercel (the "vercel-build" script). On
// production builds it migrates the database and sets the app role's password,
// so a deploy never goes live on an old schema; a failure stops the deploy.
// Preview builds skip it: they have no database settings and run on demo data.
//   Needs DATABASE_ADMIN_URL (owner, direct connection) and DB_APP_PASSWORD.

import pg from "pg";
import { migrate } from "./migrate.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.DB_APP_PASSWORD;

if (process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations on a ${process.env.VERCEL_ENV ?? "local"} build.`);
} else if (!adminUrl || !appPassword) {
  console.error("Production build needs DATABASE_ADMIN_URL and DB_APP_PASSWORD. See docs/vercel.md.");
  process.exit(1);
} else {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  try {
    // The owner must see every MSP's rows for the background jobs.
    const ok = (await db.query("select rolsuper or rolbypassrls as ok from pg_roles where rolname = current_user")).rows[0]?.ok;
    if (!ok) throw new Error("The DATABASE_ADMIN_URL role needs BYPASSRLS. See docs/vercel.md.");
  } finally {
    await db.end();
  }
  await migrate(adminUrl);
  const db2 = new pg.Client({ connectionString: adminUrl });
  await db2.connect();
  try {
    await db2.query("alter role zinloop_app login password " + db2.escapeLiteral(appPassword));
  } finally {
    await db2.end();
  }
  console.log("Database is up to date.");
}
