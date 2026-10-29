// Creates (or resets the password of) a platform super-admin. Runs as the DB
// owner, so it writes platform_admins directly. Prints nothing secret.
//   DATABASE_ADMIN_URL=postgres://... npm run db:create-superadmin -- admin@example.com 'the password'

import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "../lib/secrets.ts";

export async function createSuperadmin(url: string, email: string, password: string): Promise<{ email: string; created: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) throw new Error("A valid email is required.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const res = await db.query<{ created: boolean }>(
      `insert into platform_admins (email, password_hash) values ($1, $2)
       on conflict (email) do update set password_hash = excluded.password_hash
       returning (xmax = 0) as created`,
      [normalized, await hashPassword(password)],
    );
    return { email: normalized, created: res.rows[0]?.created ?? false };
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [email, password] = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !email || !password) {
    console.error("usage: DATABASE_ADMIN_URL=... npm run db:create-superadmin -- admin@example.com 'password'");
    process.exit(1);
  }
  createSuperadmin(url, email, password)
    .then(({ email, created }) => console.log(`${created ? "Created" : "Updated"} super-admin ${email}.`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
