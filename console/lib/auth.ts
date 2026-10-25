// Sign-in and sessions. Framework-free so it can be tested directly; the
// Next.js cookie handling is in lib/session.ts.

import { lookup, withTenant } from "./db.ts";
import { decrypt, sign, verifySigned } from "./crypto.ts";
import { allow } from "./ratelimit.ts";
import { DUMMY_PASSWORD_HASH, newToken, tokenHash, verifyPassword } from "./secrets.ts";
import { checkCode } from "./totp.ts";
import { audit } from "./audit.ts";

export const SESSION_HOURS = 12;
/** A session also ends after this long without use. */
export const SESSION_IDLE_MINUTES = Math.min(Math.max(Number(process.env.SESSION_IDLE_MINUTES) || 240, 5), SESSION_HOURS * 60);

export interface Session {
  userId: string;
  mspId: string;
  email: string;
  mspName: string;
  role: "owner" | "member" | "technician" | "viewer";
  /** For a client viewer: the one client they can see. */
  clientId: string | null;
  clientName: string | null;
  /** This user has two-factor sign-in on. */
  mfa: boolean;
  /** The MSP requires two-factor sign-in for everyone. */
  requireMfa: boolean;
  sessionId: string;
}

/** Where a sign-in came from, kept with the session and in the audit log. */
export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
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
export async function signIn(email: string, password: string, ip: string | null = null, userAgent: string | null = null): Promise<SignInResult> {
  const addr = email.trim().toLowerCase();
  if (!(await allow("signInEmail", addr))) return { kind: "limited" };
  if (ip && !(await allow("signInIp", ip))) return { kind: "limited" };
  const user = await lookup<{ user_id: string; msp_id: string; password_hash: string; mfa: boolean }>(
    "select * from auth_find_user($1)",
    [addr],
  );
  // Always run one scrypt so a wrong email takes as long as a wrong password.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user) return { kind: "wrong" };
  if (!ok) {
    await audit(user.msp_id, { userId: user.user_id, email: addr, ip }, "sign_in_failed", "", { reason: "wrong password" });
    return { kind: "wrong" };
  }
  if (user.mfa) {
    return { kind: "mfa", pending: sign("mfa", { u: user.user_id, m: user.msp_id }, MFA_PENDING_SECONDS) };
  }
  const token = await createSession(user.user_id, user.msp_id, { ip, userAgent });
  await audit(user.msp_id, { userId: user.user_id, email: addr, ip }, "signed_in");
  return { kind: "session", token };
}

/** Second step of sign-in: the code from the authenticator app. */
export async function finishMfa(pending: string | undefined, code: string, info: ClientInfo = {}): Promise<SignInResult> {
  const p = verifySigned<{ u: string; m: string }>("mfa", pending);
  if (!p) return { kind: "wrong" };
  if (!(await allow("mfa", p.u))) return { kind: "limited" };
  let email = "";
  const ok = await withTenant(p.m, async (db) => {
    const row = (
      await db.query<{ email: string; totp_secret: string | null; totp_last_step: string }>(
        "select email, totp_secret, totp_last_step from users where id = $1 and totp_enabled_at is not null",
        [p.u],
      )
    ).rows[0];
    if (!row?.totp_secret) return false;
    email = row.email;
    const step = checkCode(decrypt(row.totp_secret), code, Number(row.totp_last_step));
    if (step === null) return false;
    // Only one request can move the step forward, so a code works once even
    // when two sign-ins race.
    const used = await db.query("update users set totp_last_step = $2 where id = $1 and totp_last_step < $2", [p.u, step]);
    return used.rowCount === 1;
  });
  const actor = { userId: p.u, email, ip: info.ip };
  if (!ok) {
    if (email) await audit(p.m, actor, "sign_in_failed", "", { reason: "wrong two-factor code" });
    return { kind: "wrong" };
  }
  const token = await createSession(p.u, p.m, info);
  await audit(p.m, actor, "signed_in", "", { twoFactor: true });
  return { kind: "session", token };
}

export async function createSession(userId: string, mspId: string, info: ClientInfo = {}): Promise<string> {
  const token = newToken("zls");
  await withTenant(mspId, (db) =>
    db.query(
      `insert into sessions (token_hash, user_id, msp_id, expires_at, ip, user_agent)
       values ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
      [tokenHash(token), userId, mspId, SESSION_HOURS, (info.ip ?? "").slice(0, 64), (info.userAgent ?? "").slice(0, 300)],
    ),
  );
  return token;
}

export async function checkSession(token: string | undefined): Promise<Session | null> {
  if (!token || !token.startsWith("zls_")) return null;
  const row = await lookup<{
    user_id: string;
    msp_id: string;
    email: string;
    msp_name: string;
    role: Session["role"];
    mfa: boolean;
    require_mfa: boolean;
    session_id: string;
    client_id: string | null;
    client_name: string | null;
  }>(
    "select * from auth_check_session($1, $2)",
    [tokenHash(token), SESSION_IDLE_MINUTES],
  );
  return row
    ? {
        userId: row.user_id,
        mspId: row.msp_id,
        email: row.email,
        mspName: row.msp_name,
        role: row.role,
        clientId: row.client_id,
        clientName: row.client_name,
        mfa: row.mfa,
        requireMfa: row.require_mfa,
        sessionId: row.session_id,
      }
    : null;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
  current: boolean;
}

/** The user's own signed-in sessions, newest use first. */
export async function listSessions(session: Session): Promise<SessionInfo[]> {
  return withTenant(session.mspId, async (db) =>
    (
      await db.query<{ id: string; created_at: Date; last_seen_at: Date; ip: string; user_agent: string }>(
        `select id, created_at, last_seen_at, ip, user_agent from sessions
         where user_id = $1 and expires_at > now() and last_seen_at > now() - make_interval(mins => $2)
         order by last_seen_at desc`,
        [session.userId, SESSION_IDLE_MINUTES],
      )
    ).rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      lastSeenAt: r.last_seen_at.toISOString(),
      ip: r.ip,
      userAgent: r.user_agent,
      current: r.id === session.sessionId,
    })),
  );
}

/** Signs the user out everywhere except this session. Returns how many were ended. */
export async function endOtherSessions(session: Session, ip: string | null = null): Promise<number> {
  const n = await withTenant(session.mspId, async (db) => {
    const res = await db.query("delete from sessions where user_id = $1 and id <> $2", [session.userId, session.sessionId]);
    if ((res.rowCount ?? 0) > 0) {
      await audit(session.mspId, { userId: session.userId, email: session.email, ip }, "sessions_ended", "", { count: res.rowCount }, db);
    }
    return res.rowCount ?? 0;
  });
  return n;
}

/** Ends every session of a user, for example after a password change or removal. */
export async function endAllSessions(mspId: string, userId: string): Promise<void> {
  await withTenant(mspId, (db) => db.query("delete from sessions where user_id = $1", [userId]));
}

export async function signOut(session: Session, token: string): Promise<void> {
  await withTenant(session.mspId, async (db) => {
    await db.query("delete from sessions where token_hash = $1", [tokenHash(token)]);
    await audit(session.mspId, { userId: session.userId, email: session.email }, "signed_out", "", {}, db);
  });
}
