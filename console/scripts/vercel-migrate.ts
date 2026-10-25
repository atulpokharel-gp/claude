// Runs before `next build` on Vercel (the "vercel-build" script). On
// production builds it migrates the database and sets the app role's password,
// so a deploy never goes live on an old schema; a failure stops the deploy.
// Preview builds skip it: they have no database settings and run on demo data.
//   Needs DATABASE_ADMIN_URL (owner, direct connection) and DB_APP_PASSWORD.

import pg from "pg";
import { migrate } from "./migrate.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.DB_APP_PASSWORD;
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const productionBranch = process.env.PRODUCTION_BRANCH || "main";

if (process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations on a ${process.env.VERCEL_ENV ?? "local"} build.`);
} else if (branch && branch !== productionBranch) {
  // Never let an unmerged branch migrate the production database.
  console.error(`Refusing a production build from branch "${branch}". In Vercel, set Settings → Git → Production Branch to "${productionBranch}".`);
  process.exit(1);
} else if (!adminUrl || !appPassword) {
  const missing = [!adminUrl && "DATABASE_ADMIN_URL", !appPassword && "DB_APP_PASSWORD"].filter(Boolean).join(", ");
  console.error(`Production build is missing ${missing}. Add it under Vercel → Settings → Environment Variables (Production). See docs/vercel.md.`);
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
