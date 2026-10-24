// Session cookie handling for server components and server actions.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkSession, SESSION_HOURS, type Session } from "./auth.ts";

export const SESSION_COOKIE = "zl_session";
/** Holds the signed "password checked, waiting for the code" value during two-factor sign-in. */
export const MFA_COOKIE = "zl_mfa";

/**
 * The signed-in MSP team member, or null. Client viewers get null here, so
 * nothing written for the MSP console can act for them by mistake; pass
 * { viewer: true } where a viewer is also allowed (their own account pages).
 */
export async function currentSession(opts: { viewer?: boolean } = {}): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await checkSession(token);
  if (s?.role === "viewer" && !opts.viewer) return null;
  return s;
}

/** Where a signed-in user lands: viewers have their own portal. */
export function homeFor(s: Session): string {
  return s.role === "viewer" ? "/portal" : "/app";
}

/**
 * The signed-in session, or a redirect to the sign-in page (or a viewer's
 * portal). When the MSP requires two-factor sign-in and this user hasn't set it
 * up, every page but the setup sends them to set it up first.
 */
export async function requireSession(opts: { mfaSetup?: boolean; viewer?: boolean } = {}): Promise<Session> {
  const s = await currentSession({ viewer: true });
  if (!s) redirect("/login");
  if (s.role === "viewer" && !opts.viewer) redirect("/portal");
  if (s.requireMfa && !s.mfa && !opts.mfaSetup) redirect(s.role === "viewer" ? "/portal/account?mfa=required" : "/app/settings?mfa=required");
  return s;
}

/** A client viewer's session; anyone else goes back to the console. */
export async function requireViewer(opts: { mfaSetup?: boolean } = {}): Promise<Session & { clientId: string }> {
  const s = await requireSession({ ...opts, viewer: true });
  if (s.role !== "viewer" || !s.clientId) redirect("/app");
  return s as Session & { clientId: string };
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
