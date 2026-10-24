"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasAppSecret, sign } from "@/lib/crypto.ts";
import { consentUrl, GraphError, hasM365 } from "@/lib/m365.ts";
import { requireSession } from "@/lib/session.ts";
import { disconnectM365, revokeM365App, syncM365 } from "@/lib/store.ts";

async function base(): Promise<string> {
  if (process.env.CONSOLE_URL) return process.env.CONSOLE_URL.replace(/\/+$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function connectM365Action(form: FormData): Promise<void> {
  const s = await requireSession();
  if (!hasM365() || !hasAppSecret()) redirect(`/app/clients/${String(form.get("clientId"))}?m365=unavailable`);
  const clientId = String(form.get("clientId") ?? "");
  const state = sign("m365", { m: s.mspId, c: clientId }, 60 * 60);
  redirect(consentUrl(state, `${await base()}/api/m365/callback`));
}

export async function syncM365Action(form: FormData): Promise<void> {
  const s = await requireSession();
  const clientId = String(form.get("clientId") ?? "");
  await syncM365(s.mspId, clientId);
  revalidatePath(`/app/clients/${clientId}`);
}

export async function disconnectM365Action(form: FormData): Promise<void> {
  const s = await requireSession();
  const clientId = String(form.get("clientId") ?? "");
  await disconnectM365(s.mspId, clientId);
  revalidatePath(`/app/clients/${clientId}`);
}

export async function revokeM365Action(clientId: string, agentId: string): Promise<{ error?: string }> {
  const s = await requireSession();
  try {
    await revokeM365App(s.mspId, clientId, agentId);
  } catch (err) {
    return { error: err instanceof GraphError || err instanceof Error ? err.message : "Couldn't revoke access." };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return {};
}
