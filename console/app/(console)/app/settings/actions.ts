"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  AccountError,
  changePassword,
  createInvite,
  disableTotp,
  enableTotp,
  removeMember,
  revokeInvite,
  setRequireMfa,
  startTotp,
} from "@/lib/accounts.ts";
import { endOtherSessions } from "@/lib/auth.ts";
import { requestInfo } from "@/lib/request-audit.ts";
import { hasAppSecret } from "@/lib/crypto.ts";
import { requireSession, setSessionCookie } from "@/lib/session.ts";
import QRCode from "qrcode";
import { otpauthUri } from "@/lib/totp.ts";

export type FormState = { error?: string; ok?: string };

function fail(err: unknown): FormState {
  if (err instanceof AccountError) return { error: err.message };
  throw err;
}

export type TotpSetup = FormState & { secret?: string; qr?: string };

export async function startTotpAction(): Promise<TotpSetup> {
  const s = await requireSession({ mfaSetup: true });
  if (!hasAppSecret()) return { error: "Two-factor sign-in needs APP_SECRET set on the server. Ask whoever runs your console." };
  const secret = await startTotp(s.mspId, s.userId);
  const qr = await QRCode.toString(otpauthUri(secret, s.email), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, qr };
}

export async function enableTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession({ mfaSetup: true });
  try {
    await enableTotp(s.mspId, s.userId, String(form.get("code") ?? ""));
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/app/settings");
  return { ok: "Two-factor sign-in is on. You'll be asked for a code each time you sign in." };
}

export async function disableTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    await disableTotp(s.mspId, s.userId, String(form.get("password") ?? ""));
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/app/settings");
  return { ok: "Two-factor sign-in is off." };
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    const token = await changePassword(s.mspId, s.userId, String(form.get("current") ?? ""), String(form.get("next") ?? ""), await requestInfo());
    await setSessionCookie(token);
  } catch (err) {
    return fail(err);
  }
  return { ok: "Password changed. Other devices have been signed out." };
}

export type InviteState = FormState & { link?: string; email?: string };

export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const s = await requireSession();
  const email = String(form.get("email") ?? "");
  try {
    const token = await createInvite(s.mspId, s.userId, email, (await requestInfo()).ip);
    const h = await headers();
    const base = process.env.CONSOLE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    revalidatePath("/app/settings");
    return { link: `${base.replace(/\/+$/, "")}/join/${token}`, email: email.trim().toLowerCase() };
  } catch (err) {
    return { ...fail(err), email };
  }
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  const s = await requireSession();
  try {
    await revokeInvite(s.mspId, s.userId, String(form.get("id") ?? ""));
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
  }
  revalidatePath("/app/settings");
}

export async function removeMemberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    await removeMember(s.mspId, s.userId, String(form.get("id") ?? ""));
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/app/settings");
  return {};
}

export async function requireMfaAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireSession();
  const on = form.get("on") === "1";
  try {
    await setRequireMfa(s.mspId, s.userId, on, (await requestInfo()).ip);
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/app/settings");
  return { ok: on ? "Everyone on your team now needs two-factor sign-in." : "Two-factor sign-in is now optional for your team." };
}

export async function endOtherSessionsAction(_prev: FormState): Promise<FormState> {
  const s = await requireSession({ mfaSetup: true });
  const n = await endOtherSessions(s, (await requestInfo()).ip);
  revalidatePath("/app/settings");
  return { ok: n === 0 ? "You weren't signed in anywhere else." : `Signed out ${n} other ${n === 1 ? "device" : "devices"}.` };
}
