// Session cookie handling for server components and server actions.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkSession, SESSION_HOURS, type Session } from "./auth.ts";

export const SESSION_COOKIE = "ag_session";

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return checkSession(token);
}

/** The signed-in session, or a redirect to the sign-in page. */
export async function requireSession(): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect("/login");
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
