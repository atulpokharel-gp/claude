"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite, AccountError, signUp } from "@/lib/accounts.ts";
import { clientIp } from "@/lib/ratelimit.ts";
import { setSessionCookie } from "@/lib/session.ts";

export type SignUpState = {
  error?: string;
  values?: { name: string; mspName: string; email: string; clients: string };
};

export async function signUpAction(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const values = {
    name: String(form.get("name") ?? ""),
    mspName: String(form.get("mspName") ?? ""),
    email: String(form.get("email") ?? ""),
    clients: String(form.get("clients") ?? ""),
  };
  if (form.get("agree") !== "on") return { error: "Please confirm you'll only scan computers you're allowed to manage.", values };
  let token: string;
  try {
    const ip = clientIp((await headers()).get("x-forwarded-for"));
    token = await signUp(
      {
        name: values.name,
        mspName: values.mspName,
        email: values.email,
        password: String(form.get("password") ?? ""),
        clientEstimate: Number(values.clients),
        wantsPartner: form.get("partner") === "on",
      },
      ip,
    );
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message, values };
    throw err;
  }
  await setSessionCookie(token);
  redirect("/app?welcome=1");
}

export type JoinState = { error?: string; name?: string };

export async function joinAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const name = String(form.get("name") ?? "");
  let token: string;
  try {
    token = await acceptInvite(String(form.get("token") ?? ""), name, String(form.get("password") ?? ""));
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message, name };
    throw err;
  }
  await setSessionCookie(token);
  redirect("/app");
}
