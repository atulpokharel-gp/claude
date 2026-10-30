"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AccountError, createClientViewerInvite, removeClientViewer, revokeInvite } from "@/lib/accounts.ts";
import { requestInfo } from "@/lib/request-audit.ts";
import { requireOwner } from "@/lib/session.ts";

export type ViewerInviteState = { error?: string; link?: string; email?: string; emailed?: boolean };

export async function inviteViewerAction(clientId: string, _prev: ViewerInviteState, form: FormData): Promise<ViewerInviteState> {
  const s = await requireOwner();
  const email = String(form.get("email") ?? "");
  try {
    const token = await createClientViewerInvite(s.mspId, s.userId, clientId, email, (await requestInfo()).ip);
    const h = await headers();
    const base = process.env.CONSOLE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    revalidatePath(`/app/clients/${clientId}`);
    const emailed = Boolean(process.env.CONSOLE_URL && process.env.SMTP_URL);
    return { link: `${base.replace(/\/+$/, "")}/join/${token}`, email: email.trim().toLowerCase(), emailed };
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message, email };
    throw err;
  }
}

export async function removeViewerAction(clientId: string, form: FormData): Promise<void> {
  const s = await requireOwner();
  try {
    await removeClientViewer(s.mspId, s.userId, clientId, String(form.get("id") ?? ""), (await requestInfo()).ip);
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
  }
  revalidatePath(`/app/clients/${clientId}`);
}

export async function cancelViewerInviteAction(clientId: string, form: FormData): Promise<void> {
  const s = await requireOwner();
  try {
    await revokeInvite(s.mspId, s.userId, String(form.get("id") ?? ""));
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
  }
  revalidatePath(`/app/clients/${clientId}`);
}
