// Creates an MSP account and its first sign-in. Prints a random password once.
//   DATABASE_ADMIN_URL=postgres://... npm run db:create-msp -- "Harbor Managed IT" admin@harbor.example

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "../lib/secrets.ts";

export async function createMsp(url: string, name: string, email: string, password?: string) {
  const pw = password ?? randomBytes(18).toString("base64url");
  const id = randomUUID();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("begin");
    // Owners are subject to row-level security too (it's forced), so act as the new MSP.
    await db.query("select set_config('app.msp_id', $1, true)", [id]);
    await db.query("insert into msps (id, name) values ($1, $2)", [id, name]);
    await db.query("insert into users (msp_id, email, password_hash) values ($1, $2, $3)", [
      id,
      email.trim().toLowerCase(),
      await hashPassword(pw),
    ]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
  return { mspId: id, password: pw };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, email] = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !name || !email) {
    console.error('usage: DATABASE_ADMIN_URL=... npm run db:create-msp -- "MSP name" admin@example.com');
    process.exit(1);
  }
  createMsp(url, name, email)
    .then(({ password }) => {
      console.log(`Created ${name}. Sign in as ${email} with this password (shown once):`);
      console.log(password);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
