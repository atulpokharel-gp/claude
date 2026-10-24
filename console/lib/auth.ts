// Sign-in and sessions. Framework-free so it can be tested directly; the
// Next.js cookie handling is in lib/session.ts.

import { lookup, withTenant } from "./db.ts";
import { DUMMY_PASSWORD_HASH, newToken, tokenHash, verifyPassword } from "./secrets.ts";

export const SESSION_HOURS = 12;

export interface Session {
  userId: string;
  mspId: string;
  email: string;
  mspName: string;
}

/** Returns a new session token, or null when the email or password is wrong. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const user = await lookup<{ user_id: string; msp_id: string; password_hash: string }>(
    "select * from auth_find_user($1)",
    [email.trim()],
  );
  // Always run one scrypt so a wrong email takes as long as a wrong password.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) return null;
  const token = newToken("zls");
  await withTenant(user.msp_id, (db) =>
    db.query(
      `insert into sessions (token_hash, user_id, msp_id, expires_at)
       values ($1, $2, $3, now() + make_interval(hours => $4))`,
      [tokenHash(token), user.user_id, user.msp_id, SESSION_HOURS],
    ),
  );
  return token;
}

export async function checkSession(token: string | undefined): Promise<Session | null> {
  if (!token || !token.startsWith("zls_")) return null;
  const row = await lookup<{ user_id: string; msp_id: string; email: string; msp_name: string }>(
    "select * from auth_check_session($1)",
    [tokenHash(token)],
  );
  return row ? { userId: row.user_id, mspId: row.msp_id, email: row.email, mspName: row.msp_name } : null;
}

export async function signOut(session: Session, token: string): Promise<void> {
  await withTenant(session.mspId, (db) => db.query("delete from sessions where token_hash = $1", [tokenHash(token)]));
}
