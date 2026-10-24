// Applies db/migrations/*.sql in order. Run with an owner/admin connection:
//   DATABASE_ADMIN_URL=postgres://... npm run db:migrate

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export async function migrate(url: string, log = console.log): Promise<void> {
  const dir = join(import.meta.dirname, "..", "db", "migrations");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await db.query("begin");
      try {
        await db.query(readFileSync(join(dir, file), "utf8"));
        await db.query("insert into schema_migrations (name) values ($1)", [file]);
        await db.query("commit");
        log(`applied ${file}`);
      } catch (err) {
        await db.query("rollback");
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    }
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
  migrate(url).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
