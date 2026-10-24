// Database access. The pool connects as the app role, which is subject to
// row-level security. Every tenant query runs inside withTenant, which pins
// the transaction to one MSP so other MSPs' rows are invisible.

import pg from "pg";

let pool: pg.Pool | null = null;

/** True when the console runs against a real database instead of demo data. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}

/** For tests: close the pool so the process can exit. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

export type Db = pg.PoolClient;

/**
 * Who a transaction works for: an MSP, or one client of an MSP (a client
 * viewer). With a clientId the database hides other clients' rows and refuses
 * changes to client data (see migration 005).
 */
export type Tenant = string | { mspId: string; clientId?: string | null };

/** Runs fn in a transaction that can only see and change rows of the tenant. */
export async function withTenant<T>(tenant: Tenant, fn: (db: Db) => Promise<T>): Promise<T> {
  const { mspId, clientId } = typeof tenant === "string" ? { mspId: tenant, clientId: null } : tenant;
  const db = await getPool().connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.msp_id', $1, true), set_config('app.client_id', $2, true)", [mspId, clientId ?? ""]);
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Runs one of the pre-tenant lookup functions (sign-in, session, upload token). */
export async function lookup<T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<T | undefined> {
  const res = await getPool().query<T>(sql, params);
  return res.rows[0];
}
