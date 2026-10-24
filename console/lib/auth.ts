// Sign-in and sessions. Framework-free so it can be tested directly; the
// Next.js cookie handling is in lib/session.ts.

import { lookup, withTenant } from "./db.ts";
import { decrypt, sign, verifySigned } from "./crypto.ts";
import { allow } from "./ratelimit.ts";
import { DUMMY_PASSWORD_HASH, newToken, tokenHash, verifyPassword } from "./secrets.ts";
import { checkCode } from "./totp.ts";

export const SESSION_HOURS = 12;

export interface Session {
  userId: string;
  mspId: string;
  email: string;
  mspName: string;
}

export type SignInResult =
  | { kind: "session"; token: string }
  | { kind: "mfa"; pending: string }
  | { kind: "wrong" }
  | { kind: "limited" };

/** How long someone has to type their code after the password checks out. */
export const MFA_PENDING_SECONDS = 5 * 60;

/**
 * Checks email and password. Without two-factor sign-in that's enough for a
 * session; with it, the caller gets a short-lived signed value to pass to
 * finishMfa with the code.
 */
export async function signIn(email: string, password: string, ip: string | null = null): Promise<SignInResult> {
  const addr = email.trim().toLowerCase();
  if (!(await allow("signInEmail", addr))) return { kind: "limited" };
  if (ip && !(await allow("signInIp", ip))) return { kind: "limited" };
  const user = await lookup<{ user_id: string; msp_id: string; password_hash: string; mfa: boolean }>(
    "select * from auth_find_user($1)",
    [addr],
  );
  // Always run one scrypt so a wrong email takes as long as a wrong password.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) return { kind: "wrong" };
  if (user.mfa) {
    return { kind: "mfa", pending: sign("mfa", { u: user.user_id, m: user.msp_id }, MFA_PENDING_SECONDS) };
  }
  return { kind: "session", token: await createSession(user.user_id, user.msp_id) };
}

/** Second step of sign-in: the code from the authenticator app. */
export async function finishMfa(pending: string | undefined, code: string): Promise<SignInResult> {
  const p = verifySigned<{ u: string; m: string }>("mfa", pending);
  if (!p) return { kind: "wrong" };
  if (!(await allow("mfa", p.u))) return { kind: "limited" };
  const ok = await withTenant(p.m, async (db) => {
    const row = (
      await db.query<{ totp_secret: string | null; totp_last_step: string }>(
        "select totp_secret, totp_last_step from users where id = $1 and totp_enabled_at is not null",
        [p.u],
      )
    ).rows[0];
    if (!row?.totp_secret) return false;
    const step = checkCode(decrypt(row.totp_secret), code, Number(row.totp_last_step));
    if (step === null) return false;
    await db.query("update users set totp_last_step = $2 where id = $1", [p.u, step]);
    return true;
  });
  if (!ok) return { kind: "wrong" };
  return { kind: "session", token: await createSession(p.u, p.m) };
}

export async function createSession(userId: string, mspId: string): Promise<string> {
  const token = newToken("zls");
  await withTenant(mspId, (db) =>
    db.query(
      `insert into sessions (token_hash, user_id, msp_id, expires_at)
       values ($1, $2, $3, now() + make_interval(hours => $4))`,
      [tokenHash(token), userId, mspId, SESSION_HOURS],
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

/** Ends every session of a user, for example after a password change or removal. */
export async function endAllSessions(mspId: string, userId: string): Promise<void> {
  await withTenant(mspId, (db) => db.query("delete from sessions where user_id = $1", [userId]));
}

export async function signOut(session: Session, token: string): Promise<void> {
  await withTenant(session.mspId, (db) => db.query("delete from sessions where token_hash = $1", [tokenHash(token)]));
}
