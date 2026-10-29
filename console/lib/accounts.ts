// Sign-up, team members, invites, two-factor setup and plan limits.

import { randomUUID } from "node:crypto";
import { audit } from "./audit.ts";
import { createSession, endAllSessions, type ClientInfo } from "./auth.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { lookup, withTenant } from "./db.ts";
import { type AccountType, classifyAccount } from "./email-kind.ts";
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

type Db = { query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }> };

/** The acting user's email, for the audit log. Throws unless they're the owner when `owner` is set. */
async function actor(db: Db, userId: string, owner = false): Promise<{ userId: string; email: string }> {
  const u = (await db.query<{ email: string; role: string }>("select email, role from users where id = $1", [userId])).rows[0];
  if (!u) throw new AccountError("Your account wasn't found. Sign in again.");
  if (owner && u.role !== "owner") throw new AccountError("Only the account owner can do this.");
  return { userId, email: u.email };
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

/**
 * Creates an MSP on the free plan and its owner, and signs them in. The account
 * type is derived from the email: a free/consumer mailbox (gmail, outlook, …)
 * signs up as an "individual" and doesn't need a company name (their own name is
 * used); a company domain signs up as an "organization" and does. Returns a
 * session token.
 */
export async function signUp(input: SignUp, ip: string | null = null): Promise<string> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new AccountError("Enter your name.");
  const email = checkEmail(input.email);
  const accountType = classifyAccount(email);
  let mspName = input.mspName.trim();
  if (mspName.length > 200) throw new AccountError("That company name is too long.");
  if (accountType === "organization") {
    if (!mspName) throw new AccountError("Enter your company's name.");
  } else if (!mspName) {
    mspName = name; // Individual: company name is optional, fall back to their own name.
  }
  checkPassword(input.password);
  if (ip && !(await allow("signUpIp", ip))) throw new AccountError("Too many sign-ups from your network. Try again in an hour.");
  const estimate = Math.min(Math.max(Math.floor(Number(input.clientEstimate) || 0), 0), 100_000);
  const mspId = randomUUID();
  const userId = randomUUID();
  const hash = await hashPassword(input.password);
  try {
    await withTenant(mspId, async (db) => {
      await db.query("insert into msps (id, name, client_estimate, wants_partner, account_type) values ($1, $2, $3, $4, $5)", [
        mspId,
        mspName,
        estimate,
        Boolean(input.wantsPartner),
        accountType,
      ]);
      await db.query(
        "insert into users (id, msp_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5, 'owner')",
        [userId, mspId, email, hash, name],
      );
      await audit(mspId, { userId, email, ip }, "signed_up", mspName, { accountType }, db);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("There's already an account for that email. Sign in instead.");
    throw err;
  }
  return createSession(userId, mspId, { ip });
}

export type TeamRole = "owner" | "member" | "technician";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
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
  accountType: AccountType;
  requireMfa: boolean;
  members: Member[];
  invites: PendingInvite[];
}

export async function getTeam(mspId: string): Promise<Team> {
  return withTenant(mspId, async (db) => {
    const msp = (await db.query<{ plan: Plan; require_mfa: boolean; account_type: AccountType }>("select plan, require_mfa, account_type from msps")).rows[0];
    const plan = msp?.plan ?? "free";
    const members = (
      await db.query<{ id: string; name: string; email: string; role: TeamRole; mfa: boolean; created_at: Date }>(
        "select id, name, email, role, totp_enabled_at is not null as mfa, created_at from users where role in ('owner', 'member', 'technician') order by created_at",
      )
    ).rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mfa: u.mfa, createdAt: u.created_at.toISOString() }));
    const invites = (
      await db.query<{ id: string; email: string; expires_at: Date }>(
        "select id, email, expires_at from invites where role in ('member', 'technician') and accepted_at is null and expires_at > now() order by created_at",
      )
    ).rows.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at.toISOString() }));
    return { plan, accountType: msp?.account_type ?? "organization", requireMfa: Boolean(msp?.require_mfa), members, invites };
  });
}

/** Creates a team invite and returns the token for the link. Only the hash is kept. Owner only. */
export async function createInvite(mspId: string, invitedBy: string, email: string, ip: string | null = null, role: "member" | "technician" = "member"): Promise<string> {
  if (role !== "member" && role !== "technician") throw new AccountError("Pick member or technician for the role.");
  return makeInvite(mspId, invitedBy, email, ip, null, role);
}

/**
 * Invites someone at a client to a read-only login that sees only that
 * client's results. Returns the token for the link. Owner only.
 */
export async function createClientViewerInvite(mspId: string, invitedBy: string, clientId: string, email: string, ip: string | null = null): Promise<string> {
  if (!isUuid(clientId)) throw new AccountError("That client wasn't found.");
  return makeInvite(mspId, invitedBy, email, ip, clientId, "viewer");
}

async function makeInvite(mspId: string, invitedBy: string, email: string, ip: string | null, clientId: string | null, inviteRole: "member" | "technician" | "viewer"): Promise<string> {
  const addr = checkEmail(email);
  await withTenant(mspId, (db) => actor(db, invitedBy, true));
  if (!(await allow("invite", mspId))) throw new AccountError("Too many invites in the last hour. Try again later.");
  const exists = await lookup<{ user_id: string }>("select user_id from auth_find_user($1)", [addr]);
  if (exists) throw new AccountError("That person already has a Zinloop account.");
  const token = newToken("zli");
  await withTenant(mspId, async (db) => {
    const who = await actor(db, invitedBy, true);
    let clientName = "";
    if (clientId) {
      const c = (await db.query<{ name: string }>("select name from clients where id = $1", [clientId])).rows[0];
      if (!c) throw new AccountError("That client wasn't found.");
      clientName = c.name;
    }
    await db.query(
      `insert into invites (msp_id, email, token_hash, invited_by, expires_at, role, client_id)
       values ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7)`,
      [mspId, addr, tokenHash(token), invitedBy, INVITE_DAYS, inviteRole, clientId],
    );
    if (clientId) await audit(mspId, { ...who, ip }, "client_login_created", addr, { clientId, client: clientName }, db);
    else await audit(mspId, { ...who, ip }, "invite_created", addr, { role: inviteRole }, db);
  });
  return token;
}

export async function revokeInvite(mspId: string, byUserId: string, inviteId: string): Promise<void> {
  if (!isUuid(inviteId)) return;
  await withTenant(mspId, async (db) => {
    const who = await actor(db, byUserId, true);
    const gone = await db.query<{ email: string }>("delete from invites where id = $1 returning email", [inviteId]);
    if (gone.rows[0]) await audit(mspId, who, "invite_revoked", gone.rows[0].email, {}, db);
  });
}

export interface InviteInfo {
  inviteId: string;
  mspId: string;
  email: string;
  mspName: string;
  role: "member" | "technician" | "viewer";
  /** For a client viewer invite: the client they'll see. */
  clientId: string | null;
  clientName: string | null;
}

export async function checkInvite(token: string | undefined): Promise<InviteInfo | null> {
  if (!token || !token.startsWith("zli_")) return null;
  const row = await lookup<{ invite_id: string; msp_id: string; email: string; msp_name: string; role: InviteInfo["role"]; client_id: string | null; client_name: string | null }>(
    "select * from invite_check($1)",
    [tokenHash(token)],
  );
  return row
    ? { inviteId: row.invite_id, mspId: row.msp_id, email: row.email, mspName: row.msp_name, role: row.role, clientId: row.client_id, clientName: row.client_name }
    : null;
}

/** Joins the team, or a client's read-only view, from an invite link. Returns a session token. */
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
      await db.query("insert into users (id, msp_id, email, password_hash, name, role, client_id) values ($1, $2, $3, $4, $5, $6, $7)", [
        userId,
        inv.mspId,
        inv.email,
        hash,
        n,
        inv.role,
        inv.clientId,
      ]);
      if (inv.role === "viewer") await audit(inv.mspId, { userId, email: inv.email }, "client_viewer_joined", inv.email, { clientId: inv.clientId, client: inv.clientName }, db);
      else await audit(inv.mspId, { userId, email: inv.email }, "member_joined", inv.email, {}, db);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AccountError("There's already an account for that email. Sign in instead.");
    throw err;
  }
  return createSession(userId, inv.mspId);
}

/** Removes a team member or technician. The owner can't be removed, and nobody removes themselves here. */
export async function removeMember(mspId: string, byUserId: string, userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  if (userId === byUserId) throw new AccountError("You can't remove yourself.");
  await withTenant(mspId, async (db) => {
    const who = await actor(db, byUserId, true);
    const res = await db.query<{ email: string }>("delete from users where id = $1 and role in ('member', 'technician') returning email", [userId]);
    if (res.rowCount !== 1) throw new AccountError("The account owner can't be removed.");
    await audit(mspId, who, "member_removed", res.rows[0].email, {}, db);
  });
}

export interface ClientViewer {
  id: string;
  name: string;
  email: string;
  mfa: boolean;
  createdAt: string;
}

export interface ClientViewers {
  viewers: ClientViewer[];
  invites: PendingInvite[];
}

/** People at a client who have, or were invited to, a read-only login for it. */
export async function listClientViewers(mspId: string, clientId: string): Promise<ClientViewers> {
  if (!isUuid(clientId)) return { viewers: [], invites: [] };
  return withTenant(mspId, async (db) => {
    const viewers = (
      await db.query<{ id: string; name: string; email: string; mfa: boolean; created_at: Date }>(
        "select id, name, email, totp_enabled_at is not null as mfa, created_at from users where role = 'viewer' and client_id = $1 order by created_at",
        [clientId],
      )
    ).rows.map((u) => ({ id: u.id, name: u.name, email: u.email, mfa: u.mfa, createdAt: u.created_at.toISOString() }));
    const invites = (
      await db.query<{ id: string; email: string; expires_at: Date }>(
        "select id, email, expires_at from invites where role = 'viewer' and client_id = $1 and accepted_at is null and expires_at > now() order by created_at",
        [clientId],
      )
    ).rows.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at.toISOString() }));
    return { viewers, invites };
  });
}

/** Removes a client viewer's login; their sessions end with it. Owner only. */
export async function removeClientViewer(mspId: string, byUserId: string, clientId: string, userId: string, ip: string | null = null): Promise<void> {
  if (!isUuid(userId) || !isUuid(clientId)) return;
  await withTenant(mspId, async (db) => {
    const who = await actor(db, byUserId, true);
    const res = await db.query<{ email: string; client: string }>(
      `delete from users u using clients c where u.id = $1 and u.role = 'viewer' and u.client_id = $2 and c.id = u.client_id
       returning u.email, c.name as client`,
      [userId, clientId],
    );
    if (res.rowCount !== 1) throw new AccountError("That login wasn't found.");
    await audit(mspId, { ...who, ip }, "client_login_removed", res.rows[0].email, { clientId, client: res.rows[0].client }, db);
  });
}

/** Turns the "everyone must use two-factor sign-in" rule on or off. Owner only. */
export async function setRequireMfa(mspId: string, byUserId: string, on: boolean, ip: string | null = null): Promise<void> {
  await withTenant(mspId, async (db) => {
    const who = await actor(db, byUserId, true);
    if (on) {
      const me = (await db.query<{ mfa: boolean }>("select totp_enabled_at is not null as mfa from users where id = $1", [byUserId])).rows[0];
      if (!me?.mfa) throw new AccountError("Turn on two-factor sign-in for your own account first.");
    }
    await db.query("update msps set require_mfa = $1", [on]);
    await audit(mspId, { ...who, ip }, "require_mfa_changed", "", { required: on }, db);
  });
}

export async function changePassword(mspId: string, userId: string, current: string, next: string, info: ClientInfo = {}): Promise<string> {
  checkPassword(next);
  const row = await withTenant(mspId, async (db) =>
    (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0],
  );
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new AccountError("Your current password is wrong.");
  const hash = await hashPassword(next);
  await withTenant(mspId, async (db) => {
    await db.query("update users set password_hash = $2 where id = $1", [userId, hash]);
    await audit(mspId, { ...(await actor(db, userId)), ip: info.ip }, "password_changed", "", {}, db);
  });
  // Sign out everywhere else, then give this browser a fresh session.
  await endAllSessions(mspId, userId);
  return createSession(userId, mspId, info);
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
    await audit(mspId, await actor(db, userId), "mfa_enabled", "", {}, db);
  });
}

export async function disableTotp(mspId: string, userId: string, password: string): Promise<void> {
  const row = await withTenant(mspId, async (db) =>
    (await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [userId])).rows[0],
  );
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new AccountError("Your password is wrong.");
  await withTenant(mspId, async (db) => {
    const required = (await db.query<{ require_mfa: boolean }>("select require_mfa from msps")).rows[0]?.require_mfa;
    if (required) throw new AccountError("Your team requires two-factor sign-in, so it can't be turned off.");
    await db.query("update users set totp_secret = null, totp_enabled_at = null, totp_last_step = 0 where id = $1", [userId]);
    await audit(mspId, await actor(db, userId), "mfa_disabled", "", {}, db);
  });
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

export interface EmailPrefs {
  alerts: boolean;
  weekly: boolean;
}

export async function getEmailPrefs(mspId: string, userId: string): Promise<EmailPrefs> {
  return withTenant(mspId, async (db) => {
    const r = (await db.query<{ alert_emails: boolean; weekly_email: boolean }>("select alert_emails, weekly_email from users where id = $1", [userId])).rows[0];
    return { alerts: Boolean(r?.alert_emails), weekly: Boolean(r?.weekly_email) };
  });
}

/** Turns the user's own alert and weekly emails on or off. */
export async function setEmailPrefs(mspId: string, userId: string, prefs: EmailPrefs): Promise<void> {
  await withTenant(mspId, (db) => db.query("update users set alert_emails = $2, weekly_email = $3 where id = $1", [userId, prefs.alerts, prefs.weekly]));
}

/** For unsubscribe links: turns one kind of email off. Returns the address, or null if the user is gone. */
export async function unsubscribe(userId: string, kind: "alert" | "weekly"): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const row = await lookup<{ email: string | null }>("select email_unsubscribe($1, $2) as email", [userId, kind]);
  return row?.email ?? null;
}
