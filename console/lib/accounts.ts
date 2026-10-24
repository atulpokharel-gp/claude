// Sign-up, team members, invites, two-factor setup and plan limits.

import { randomUUID } from "node:crypto";
import { createSession, endAllSessions } from "./auth.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { lookup, withTenant } from "./db.ts";
import { allow } from "./ratelimit.ts";
import { hashPassword, newToken, tokenHash, verifyPassword } from "./secrets.ts";
import { checkCode, newTotpSecret } from "./totp.ts";

export class AccountError extends Error {}

export type Plan = "free" | "partner" | "msp";

/** What each plan allows. Payments aren't built yet; plans are set by hand (npm run db:set-plan). */
export const PLAN_LIMITS: Record<Plan, { clients: number; devices: number }> = {
  free: { clients: 1, devices: 25 },
  partner: { clients: Infinity, devices: Infinity },
  msp: { clients: Infinity, devices: Infinity },
};

export const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_DAYS = 7;

export function checkEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 320) throw new AccountError("Enter a valid email address.");
  return e;
}

export function checkPassword(pw: string): void {
  if (pw.length < MIN_PASSWORD) throw new AccountError(`Use at least ${MIN_PASSWORD} characters for your password.`);
  if (pw.length > 200) throw new AccountError("That password is too long.");
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

export interface SignUp {
  name: string;
  mspName: string;
  email: string;
  password: string;
  clientEstimate?: number;
  wantsPartner?: boolean;
}

/** Creates an MSP on the free plan and its owner, and signs them in. Returns a session token. */
export async function signUp(input: SignUp, ip: string | null = null): Promise<string> {
  const name = input.name.trim();
  const mspName = input.mspName.trim();
  if (!name || name.length > 200) throw new AccountError("Enter your name.");
  if (!mspName || mspName.length > 200) throw new AccountError("Enter your company's name.");
  const email = checkEmail(input.email);
  checkPassword(input.password);
  if (ip && !(await allow("signUpIp", ip))) throw new AccountError("Too many sign-ups from your network. Try again in an hour.");
  const estimate = Math.min(Math.max(Math.floor(Number(input.clientEstimate) || 0), 0), 100_000);
  const mspId = randomUUID();
  const userId = randomUUID();
  const hash = await hashPassword(input.password);
  try {
    await withTenant(mspId, async (db) => {
      await db.query("insert into msps (id, name, client_estimate, wants_partner) values ($1, $2, $3, $4)", [
        mspId,
        mspName,
        estimate,
        Boolean(input.wantsPartner),
      ]);
      await db.query(
        "insert into users (id, msp_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5, 'owner')",
        [userId, mspId, email, hash, name],
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("There's already an account for that email. Sign in instead.");
    throw err;
  }
  return createSession(userId, mspId);
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  mfa: boolean;
  createdAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
}

export interface Team {
  plan: Plan;
  members: Member[];
  invites: PendingInvite[];
}

export async function getTeam(mspId: string): Promise<Team> {
  return withTenant(mspId, async (db) => {
    const plan = (await db.query<{ plan: Plan }>("select plan from msps")).rows[0]?.plan ?? "free";
    const members = (
      await db.query<{ id: string; name: string; email: string; role: "owner" | "member"; mfa: boolean; created_at: Date }>(
        "select id, name, email, role, totp_enabled_at is not null as mfa, created_at from users order by created_at",
      )
    ).rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mfa: u.mfa, createdAt: u.created_at.toISOString() }));
    const invites = (
      await db.query<{ id: string; email: string; expires_at: Date }>(
        "select id, email, expires_at from invites where accepted_at is null and expires_at > now() order by created_at",
      )
    ).rows.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at.toISOString() }));
    return { plan, members, invites };
  });
}

/** Creates an invite and returns the token for the link. Only the hash is kept. */
export async function createInvite(mspId: string, invitedBy: string, email: string): Promise<string> {
  const addr = checkEmail(email);
  if (!(await allow("invite", mspId))) throw new AccountError("Too many invites in the last hour. Try again later.");
  const exists = await lookup<{ user_id: string }>("select user_id from auth_find_user($1)", [addr]);
  if (exists) throw new AccountError("That person already has a Zinloop account.");
  const token = newToken("zli");
  await withTenant(mspId, (db) =>
    db.query(
      `insert into invites (msp_id, email, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [mspId, addr, tokenHash(token), invitedBy, INVITE_DAYS],
    ),
  );
  return token;
}

export async function revokeInvite(mspId: string, inviteId: string): Promise<void> {
  if (!isUuid(inviteId)) return;
  await withTenant(mspId, (db) => db.query("delete from invites where id = $1", [inviteId]));
}

export interface InviteInfo {
  inviteId: string;
  mspId: string;
  email: string;
  mspName: string;
}

export async function checkInvite(token: string | undefined): Promise<InviteInfo | null> {
  if (!token || !token.startsWith("zli_")) return null;
  const row = await lookup<{ invite_id: string; msp_id: string; email: string; msp_name: string }>(
    "select * from invite_check($1)",
    [tokenHash(token)],
  );
  return row ? { inviteId: row.invite_id, mspId: row.msp_id, email: row.email, mspName: row.msp_name } : null;
}

/** Joins the team from an invite link. Returns a session token. */
export async function acceptInvite(token: string, name: string, password: string): Promise<string> {
  const inv = await checkInvite(token);
  if (!inv) throw new AccountError("This invite link has expired or was already used. Ask for a new one.");
  const n = name.trim();
  if (!n || n.length > 200) throw new AccountError("Enter your name.");
  checkPassword(password);
  const hash = await hashPassword(password);
  const userId = randomUUID();
  try {
    await withTenant(inv.mspId, async (db) => {
      const used = await db.query("update invites set accepted_at = now() where id = $1 and accepted_at is null", [inv.inviteId]);
      if (used.rowCount !== 1) throw new AccountError("This invite link was already used.");
      await db.query("insert into users (id, msp_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5, 'member')", [
        userId,
        inv.mspId,
        inv.email,
        hash,
        n,
      ]);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("There's already an account for that email. Sign in instead.");
    throw err;
  }
  return createSession(userId, inv.mspId);
}

/** Removes a team member. The owner can't be removed, and nobody removes themselves here. */
export async function removeMember(mspId: string, byUserId: string, userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  if (userId === byUserId) throw new AccountError("You can't remove yourself.");
  await withTenant(mspId, async (db) => {
    const res = await db.query("delete from users where id = $1 and role <> 'owner'", [userId]);
    if (res.rowCount !== 1) throw new AccountError("The account owner can't be removed.");
  });
}

export async function changePassword(mspId: string, userId: string, current: string, next: string): Promise<string> {
  checkPassword(next);
  const row = await withTenant(mspId, async (db) =>
    (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0],
  );
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new AccountError("Your current password is wrong.");
  const hash = await hashPassword(next);
  await withTenant(mspId, (db) => db.query("update users set password_hash = $2 where id = $1", [userId, hash]));
  // Sign out everywhere else, then give this browser a fresh session.
  await endAllSessions(mspId, userId);
  return createSession(userId, mspId);
}

/** Starts two-factor setup: stores a new secret (not yet active) and returns it for the QR code. */
export async function startTotp(mspId: string, userId: string): Promise<string> {
  const secret = newTotpSecret();
  await withTenant(mspId, (db) =>
    db.query("update users set totp_secret = $2 where id = $1 and totp_enabled_at is null", [userId, encrypt(secret)]),
  );
  return secret;
}

/** Turns two-factor sign-in on once the user proves their app shows the right code. */
export async function enableTotp(mspId: string, userId: string, code: string): Promise<void> {
  await withTenant(mspId, async (db) => {
    const row = (
      await db.query<{ totp_secret: string | null; totp_enabled_at: Date | null }>(
        "select totp_secret, totp_enabled_at from users where id = $1",
        [userId],
      )
    ).rows[0];
    if (!row?.totp_secret || row.totp_enabled_at) throw new AccountError("Start two-factor setup again.");
    const step = checkCode(decrypt(row.totp_secret), code, 0);
    if (step === null) throw new AccountError("That code doesn't match. Check the time on your phone and try the next code.");
    await db.query("update users set totp_enabled_at = now(), totp_last_step = $2 where id = $1", [userId, step]);
  });
}

export async function disableTotp(mspId: string, userId: string, password: string): Promise<void> {
  const row = await withTenant(mspId, async (db) =>
    (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0],
  );
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new AccountError("Your password is wrong.");
  await withTenant(mspId, (db) =>
    db.query("update users set totp_secret = null, totp_enabled_at = null, totp_last_step = 0 where id = $1", [userId]),
  );
}

/** Throws when the MSP's plan doesn't allow another client. */
export async function checkClientLimit(db: { query: (q: string) => Promise<{ rows: { plan: Plan; n: number }[] }> }) {
  const r = (await db.query("select (select plan from msps) as plan, (select count(*)::int from clients) as n")).rows[0];
  const limit = PLAN_LIMITS[r?.plan ?? "free"].clients;
  if (r && r.n >= limit) {
    throw new AccountError(`The free plan covers ${limit} client. Contact us to add more.`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID.test(v);
}
