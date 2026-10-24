// Changes an MSP's plan by the owner's email. Payments aren't built yet, so
// upgrades are done by hand:
//   DATABASE_ADMIN_URL=postgres://... npm run db:set-plan -- admin@harbor.example partner

import { fileURLToPath } from "node:url";
import pg from "pg";

const PLANS = ["free", "partner", "msp"] as const;

export async function setPlan(url: string, email: string, plan: string): Promise<string> {
  if (!PLANS.includes(plan as (typeof PLANS)[number])) throw new Error(`Plan must be one of: ${PLANS.join(", ")}`);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("begin");
    const user = (await db.query<{ msp_id: string }>("select msp_id from auth_find_user($1)", [email])).rows[0];
    if (!user) throw new Error(`No account for ${email}`);
    await db.query("select set_config('app.msp_id', $1, true)", [user.msp_id]);
    const res = await db.query<{ name: string }>("update msps set plan = $2 where id = $1 returning name", [user.msp_id, plan]);
    await db.query("commit");
    return res.rows[0].name;
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [email, plan] = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !email || !plan) {
    console.error("usage: DATABASE_ADMIN_URL=... npm run db:set-plan -- owner@example.com free|partner|msp");
    process.exit(1);
  }
  setPlan(url, email, plan)
    .then((name) => console.log(`${name} is now on the ${plan} plan.`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
