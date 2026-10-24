"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth.ts";
import { clearSessionCookie, currentSession, sessionToken, setSessionCookie } from "@/lib/session.ts";

export type SignInState = { error?: string; email?: string };

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  const token = await signIn(email, password);
  // Hand the email back so the form keeps it after React resets the inputs.
  if (!token) return { error: "That email and password don't match.", email };
  await setSessionCookie(token);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const s = await currentSession();
  const token = await sessionToken();
  if (s && token) await signOut(s, token);
  await clearSessionCookie();
  redirect("/login");
}
