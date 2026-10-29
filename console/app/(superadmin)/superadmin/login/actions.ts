"use server";

import { redirect } from "next/navigation";
import { requestInfo } from "@/lib/request-audit.ts";
import { clearSuperadminCookie, setSuperadminCookie, superadminLogin } from "@/lib/superadmin.ts";

export async function superadminLoginAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const info = await requestInfo();
  const token = await superadminLogin(email, password, info.ip ?? null);
  if (!token) return { error: "Wrong email or password, or too many attempts." };
  await setSuperadminCookie(token);
  redirect("/superadmin");
}

export async function superadminLogoutAction(): Promise<void> {
  await clearSuperadminCookie();
  redirect("/superadmin/login");
}
