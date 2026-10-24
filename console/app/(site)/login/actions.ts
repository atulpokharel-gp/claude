"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { finishMfa, MFA_PENDING_SECONDS, signIn, signOut, type SignInResult } from "@/lib/auth.ts";
import { requestInfo } from "@/lib/request-audit.ts";
import { clearSessionCookie, currentSession, MFA_COOKIE, sessionToken, setSessionCookie } from "@/lib/session.ts";

export type SignInState = { error?: string; email?: string };


async function finish(r: SignInResult, email?: string): Promise<SignInState> {
  if (r.kind === "limited") return { error: "Too many attempts. Wait 15 minutes and try again.", email };
  if (r.kind === "wrong") return { error: email !== undefined ? "That email and password don't match." : "That code doesn't match. Try the next one.", email };
  const jar = await cookies();
  if (r.kind === "mfa") {
    jar.set(MFA_COOKIE, r.pending, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ALLOW_HTTP_COOKIES !== "1",
      path: "/login",
      maxAge: MFA_PENDING_SECONDS,
    });
    redirect("/login");
  }
  jar.delete({ name: MFA_COOKIE, path: "/login" });
  await setSessionCookie(r.token);
  redirect("/app");
}

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  // Hand the email back so the form keeps it after React resets the inputs.
  if (!email || !password) return { error: "Enter your email and password.", email };
  const { ip, userAgent } = await requestInfo();
  return finish(await signIn(email, password, ip, userAgent), email);
}

export async function mfaAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const code = String(form.get("code") ?? "");
  const pending = (await cookies()).get(MFA_COOKIE)?.value;
  return finish(await finishMfa(pending, code, await requestInfo()));
}

export async function cancelMfaAction(): Promise<void> {
  (await cookies()).delete({ name: MFA_COOKIE, path: "/login" });
  redirect("/login");
}

export async function signOutAction(): Promise<void> {
  const s = await currentSession();
  const token = await sessionToken();
  if (s && token) await signOut(s, token);
  await clearSessionCookie();
  redirect("/login");
}
