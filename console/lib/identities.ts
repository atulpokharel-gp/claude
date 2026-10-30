// Linking Microsoft accounts to Zinloop users, and signing in with them.

import { randomUUID } from "node:crypto";
import { insertOwnerAccount } from "./accounts.ts";
import { audit } from "./audit.ts";
import { createSession, MFA_PENDING_SECONDS, type ClientInfo, type Session, type SignInResult } from "./auth.ts";
import { sign } from "./crypto.ts";
import { lookup, withTenant } from "./db.ts";
import { consumerDomains } from "./email-domains.ts";
import { classifyAccount, orgNameFromDomain } from "./email-kind.ts";
import type { MicrosoftAccount } from "./microsoft-sso.ts";
import type { GoogleAccount } from "./google-sso.ts";
import { allow } from "./ratelimit.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google accounts are matched on the stable OIDC `sub`, stored in object_id with
// a constant tenant_id sentinel so the shared user_identities machinery applies.
const GOOGLE_TENANT = "google";

export class LinkError extends Error {}

export interface MicrosoftLink {
  label: string;
  createdAt: string;
}

export async function getMicrosoftLink(s: Session): Promise<MicrosoftLink | null> {
  return withTenant(s.mspId, async (db) => {
    const r = (
      await db.query<{ label: string; created_at: Date }>("select label, created_at from user_identities where user_id = $1 and provider = 'microsoft'", [s.userId])
    ).rows[0];
    return r ? { label: r.label, createdAt: r.created_at.toISOString() } : null;
  });
}

/** Links the signed-in user to a Microsoft account. One Microsoft account per Zinloop user, and the other way round. */
export async function linkMicrosoft(s: Session, account: MicrosoftAccount, ip: string | null = null): Promise<void> {
  try {
    await withTenant(s.mspId, async (db) => {
      await db.query("delete from user_identities where user_id = $1 and provider = 'microsoft'", [s.userId]);
      await db.query(
        "insert into user_identities (user_id, msp_id, provider, tenant_id, object_id, label) values ($1, $2, 'microsoft', $3, $4, $5)",
        [s.userId, s.mspId, account.tenantId, account.objectId, account.label],
      );
      await audit(s.mspId, { userId: s.userId, email: s.email, ip }, "microsoft_linked", account.label, { tenantId: account.tenantId }, db);
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new LinkError("That Microsoft account is already linked to another Zinloop login.");
    throw err;
  }
}

export async function unlinkMicrosoft(s: Session, ip: string | null = null): Promise<void> {
  await withTenant(s.mspId, async (db) => {
    const gone = await db.query<{ label: string }>("delete from user_identities where user_id = $1 and provider = 'microsoft' returning label", [s.userId]);
    if (gone.rows[0]) await audit(s.mspId, { userId: s.userId, email: s.email, ip }, "microsoft_unlinked", gone.rows[0].label, {}, db);
  });
}

/**
 * Signs in with a verified Microsoft account. Only a linked account works;
 * when the user has two-factor sign-in on, they're still asked for their code,
 * just as after a password.
 */
export async function signInWithMicrosoft(account: MicrosoftAccount, info: ClientInfo = {}): Promise<SignInResult | { kind: "not-linked" }> {
  if (info.ip && !(await allow("signInIp", info.ip))) return { kind: "limited" };
  const user = await lookup<{ user_id: string; msp_id: string; email: string; mfa: boolean }>(
    "select * from auth_find_identity('microsoft', $1, $2)",
    [account.tenantId, account.objectId],
  );
  if (!user) return { kind: "not-linked" };
  if (user.mfa) return { kind: "mfa", pending: sign("mfa", { u: user.user_id, m: user.msp_id }, MFA_PENDING_SECONDS) };
  const token = await createSession(user.user_id, user.msp_id, info);
  await audit(user.msp_id, { userId: user.user_id, email: user.email, ip: info.ip }, "signed_in", "", { method: "microsoft" });
  return { kind: "session", token };
}

// ---- Google ----

export interface GoogleLink {
  label: string;
  createdAt: string;
}

export async function getGoogleLink(s: Session): Promise<GoogleLink | null> {
  return withTenant(s.mspId, async (db) => {
    const r = (
      await db.query<{ label: string; created_at: Date }>("select label, created_at from user_identities where user_id = $1 and provider = 'google'", [s.userId])
    ).rows[0];
    return r ? { label: r.label, createdAt: r.created_at.toISOString() } : null;
  });
}

/** Links the signed-in user to a Google account. One Google account per Zinloop user, and the other way round. */
export async function linkGoogle(s: Session, account: GoogleAccount, ip: string | null = null): Promise<void> {
  try {
    await withTenant(s.mspId, async (db) => {
      await db.query("delete from user_identities where user_id = $1 and provider = 'google'", [s.userId]);
      await db.query(
        "insert into user_identities (user_id, msp_id, provider, tenant_id, object_id, label) values ($1, $2, 'google', $3, $4, $5)",
        [s.userId, s.mspId, GOOGLE_TENANT, account.sub, account.label],
      );
      await audit(s.mspId, { userId: s.userId, email: s.email, ip }, "google_linked", account.label, {}, db);
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new LinkError("That Google account is already linked to another Zinloop login.");
    throw err;
  }
}

export async function unlinkGoogle(s: Session, ip: string | null = null): Promise<void> {
  await withTenant(s.mspId, async (db) => {
    const gone = await db.query<{ label: string }>("delete from user_identities where user_id = $1 and provider = 'google' returning label", [s.userId]);
    if (gone.rows[0]) await audit(s.mspId, { userId: s.userId, email: s.email, ip }, "google_unlinked", gone.rows[0].label, {}, db);
  });
}

/**
 * Signs in with a verified Google account. Only a linked account works; when the
 * user has two-factor sign-in on, they're still asked for their code, just as
 * after a password.
 */
export async function signInWithGoogle(account: GoogleAccount, info: ClientInfo = {}): Promise<SignInResult | { kind: "not-linked" }> {
  if (info.ip && !(await allow("signInIp", info.ip))) return { kind: "limited" };
  const user = await lookup<{ user_id: string; msp_id: string; email: string; mfa: boolean }>(
    "select * from auth_find_identity('google', $1, $2)",
    [GOOGLE_TENANT, account.sub],
  );
  if (!user) return { kind: "not-linked" };
  if (user.mfa) return { kind: "mfa", pending: sign("mfa", { u: user.user_id, m: user.msp_id }, MFA_PENDING_SECONDS) };
  const token = await createSession(user.user_id, user.msp_id, info);
  await audit(user.msp_id, { userId: user.user_id, email: user.email, ip: info.ip }, "signed_in", "", { method: "google" });
  return { kind: "session", token };
}

/**
 * Signs up with a verified Google account from the public sign-up page.
 *
 *  - If the Google account is already linked, this just signs that user in (so
 *    clicking "Sign up with Google" when you already have an account works).
 *  - If the email already belongs to a Zinloop login (a password account or
 *    another provider), it refuses with "exists" and the page tells them to sign
 *    in and link Google in settings — a Google sign-in never silently takes over
 *    an existing account.
 *  - Otherwise it creates a new MSP and owner with no password (they can set one
 *    later with "Forgot password"), classifies it as individual or organization
 *    from the email domain just like the password sign-up, links the Google
 *    identity, and signs in.
 */
export async function signUpWithGoogle(account: GoogleAccount, info: ClientInfo = {}): Promise<SignInResult | { kind: "not-linked" } | { kind: "exists" }> {
  if (info.ip && !(await allow("signUpIp", info.ip))) return { kind: "limited" };
  // Already linked? Sign in instead of making a second account.
  const linked = await lookup<{ user_id: string }>("select user_id from auth_find_identity('google', $1, $2)", [GOOGLE_TENANT, account.sub]);
  if (linked) return signInWithGoogle(account, info);

  const email = account.label.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) return { kind: "wrong" };
  // Don't adopt an address that already has an account — they sign in and link.
  if (await lookup("select user_id from auth_find_user($1)", [email])) return { kind: "exists" };

  const consumer = await consumerDomains();
  const accountType = classifyAccount(email, consumer);
  const name = (account.name || "").trim().slice(0, 200) || email.split("@")[0].slice(0, 200);
  const mspName = accountType === "organization" ? orgNameFromDomain(email, consumer) || name : name;
  const mspId = randomUUID();
  const userId = randomUUID();
  try {
    await withTenant(mspId, async (db) => {
      await insertOwnerAccount(db, { mspId, userId, email, name, mspName, accountType, passwordHash: null, ip: info.ip, method: "google" });
      await db.query(
        "insert into user_identities (user_id, msp_id, provider, tenant_id, object_id, label) values ($1, $2, 'google', $3, $4, $5)",
        [userId, mspId, GOOGLE_TENANT, account.sub, account.label],
      );
      await audit(mspId, { userId, email, ip: info.ip }, "google_linked", account.label, {}, db);
    });
  } catch (err) {
    // Lost a race (the email or this Google account got an account meanwhile).
    if ((err as { code?: string }).code === "23505") return { kind: "exists" };
    throw err;
  }
  const token = await createSession(userId, mspId, info);
  await audit(mspId, { userId, email, ip: info.ip }, "signed_in", "", { method: "google" });
  return { kind: "session", token };
}
