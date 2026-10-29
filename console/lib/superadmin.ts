// Platform super-admin: auth and the cross-tenant read models for the ops
// dashboard. Kept entirely separate from tenant sessions — its own signed
// cookie, its own table, its own queries (through SECURITY DEFINER functions
// that bypass RLS but return metadata only).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasAppSecret, sign, verifySigned } from "./crypto.ts";
import { getPool, hasDatabase, lookup } from "./db.ts";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./secrets.ts";
import { allow } from "./ratelimit.ts";

const COOKIE = "zl_superadmin";
const TTL_SECONDS = 12 * 60 * 60;

export interface Superadmin {
  id: string;
  email: string;
}

export function hasSuperadmin(): boolean {
  return hasDatabase() && hasAppSecret();
}

/**
 * Verify email + password. Returns a signed session token, or null. Runs a
 * dummy hash when the email is unknown so a wrong email and a wrong password
 * take the same time.
 */
export async function superadminLogin(email: string, password: string, ip: string | null): Promise<string | null> {
  if (ip && !(await allow("signInIp", ip))) return null;
  const row = await lookup<{ id: string; email: string; password_hash: string }>(
    "select * from superadmin_by_email($1)",
    [email.trim().toLowerCase()],
  );
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!row || !ok) return null;
  await getPool().query("select superadmin_touch_login($1)", [row.id]);
  return sign("superadmin", { aid: row.id }, TTL_SECONDS);
}

export async function setSuperadminCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.ALLOW_HTTP_COOKIES !== "1",
    path: "/superadmin",
    maxAge: TTL_SECONDS,
  });
}

export async function clearSuperadminCookie(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/superadmin" });
}

/** The signed-in super-admin, re-checked against the DB each request. */
export async function currentSuperadmin(): Promise<Superadmin | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const payload = verifySigned<{ aid: string }>("superadmin", token);
  if (!payload) return null;
  const row = await lookup<{ id: string; email: string }>("select * from superadmin_by_id($1)", [payload.aid]);
  return row ? { id: row.id, email: row.email } : null;
}

export async function requireSuperadmin(): Promise<Superadmin> {
  const admin = await currentSuperadmin();
  if (!admin) redirect("/superadmin/login");
  return admin;
}

// ---- Dashboard read models ----
export interface PlatformStats {
  companies: number; users: number; devices: number; scans: number; signups_30d: number; new_companies_30d: number;
}
export interface CompanyRow {
  id: string; name: string; plan: string; account_type: string; created_at: string; users: number; devices: number; last_scan_at: string | null;
}
export interface PlatformUserRow {
  id: string; email: string; name: string | null; role: string; msp_id: string; company: string; created_at: string;
}
export interface RegistrationPoint { day: string; users: number; companies: number; }

const num = (v: unknown) => Number(v ?? 0);

export async function platformStats(): Promise<PlatformStats> {
  const r = (await getPool().query("select * from superadmin_stats()")).rows[0] ?? {};
  return {
    companies: num(r.companies), users: num(r.users), devices: num(r.devices), scans: num(r.scans),
    signups_30d: num(r.signups_30d), new_companies_30d: num(r.new_companies_30d),
  };
}

export async function listCompanies(): Promise<CompanyRow[]> {
  const rows = (await getPool().query("select * from superadmin_companies()")).rows;
  return rows.map((r) => ({
    id: r.id, name: r.name, plan: r.plan, account_type: r.account_type ?? "organization",
    created_at: r.created_at?.toISOString?.() ?? String(r.created_at),
    users: num(r.users), devices: num(r.devices),
    last_scan_at: r.last_scan_at ? (r.last_scan_at.toISOString?.() ?? String(r.last_scan_at)) : null,
  }));
}

export async function listPlatformUsers(limit = 500): Promise<PlatformUserRow[]> {
  const rows = (await getPool().query("select * from superadmin_users($1)", [limit])).rows;
  return rows.map((r) => ({
    id: r.id, email: r.email, name: r.name, role: r.role, msp_id: r.msp_id, company: r.company,
    created_at: r.created_at?.toISOString?.() ?? String(r.created_at),
  }));
}

export async function registrationTrend(days = 30): Promise<RegistrationPoint[]> {
  const rows = (await getPool().query("select * from superadmin_registrations($1)", [days])).rows;
  return rows.map((r) => ({ day: r.day?.toISOString?.().slice(0, 10) ?? String(r.day), users: num(r.users), companies: num(r.companies) }));
}
