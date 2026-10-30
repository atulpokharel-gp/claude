"use server";

import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/accounts.ts";
import { clientIp } from "@/lib/ratelimit.ts";

export type ForgotState = { done?: boolean; email?: string };

export async function forgotAction(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get("email") ?? "");
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  // Always succeeds the same way, whether or not the address has an account.
  await requestPasswordReset(email, ip);
  return { done: true, email: email.trim().toLowerCase() };
}
