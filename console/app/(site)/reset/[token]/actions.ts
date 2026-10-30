"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountError, resetPassword } from "@/lib/accounts.ts";
import { clientIp } from "@/lib/ratelimit.ts";

export type ResetState = { error?: string };

export async function resetAction(_prev: ResetState, form: FormData): Promise<ResetState> {
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  try {
    await resetPassword(String(form.get("token") ?? ""), String(form.get("password") ?? ""), { ip });
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message };
    throw err;
  }
  // Signed out everywhere; sign in fresh (so two-factor sign-in still applies).
  redirect("/login?reset=1");
}
