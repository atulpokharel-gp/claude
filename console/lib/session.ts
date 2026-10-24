// Session cookie handling for server components and server actions.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkSession, SESSION_HOURS, type Session } from "./auth.ts";

export const SESSION_COOKIE = "zl_session";
/** Holds the signed "password checked, waiting for the code" value during two-factor sign-in. */
export const MFA_COOKIE = "zl_mfa";

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return checkSession(token);
}

/**
 * The signed-in session, or a redirect to the sign-in page. When the MSP
 * requires two-factor sign-in and this user hasn't set it up, every page but
 * the setup sends them to settings first.
 */
export async function requireSession(opts: { mfaSetup?: boolean } = {}): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.requireMfa && !s.mfa && !opts.mfaSetup) redirect("/app/settings?mfa=required");
  return s;
}

/** Like requireSession, for actions only the account owner may take. */
export async function requireOwner(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "owner") redirect("/app/settings?owner=required");
  return s;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Plain http only for local testing; set ALLOW_HTTP_COOKIES=1 there.
    secure: process.env.ALLOW_HTTP_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
