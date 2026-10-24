"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditAs } from "@/lib/request-audit.ts";
import { requireSession } from "@/lib/session.ts";
import { createClient, createUploadToken, revokeUploadToken } from "@/lib/store.ts";

export type NewClientState = { error?: string; values?: Record<string, string> };

export async function createClientAction(_prev: NewClientState, form: FormData): Promise<NewClientState> {
  const s = await requireSession();
  const values = Object.fromEntries(["name", "industry", "staff", "devices"].map((k) => [k, String(form.get(k) ?? "")]));
  let id: string;
  try {
    id = await createClient(s.mspId, {
      name: values.name,
      industry: values.industry,
      staff: Number(values.staff),
      devicesExpected: Number(values.devices),
    });
  } catch (err) {
    // Hand the values back so the form keeps them after React resets the inputs.
    return { error: (err as Error).message, values };
  }
  await auditAs(s, "client_created", values.name.trim(), { clientId: id });
  redirect(`/app/clients/${id}`);
}

export type TokenState = { token?: string; error?: string };

export async function createTokenAction(clientId: string, _prev: TokenState, form: FormData): Promise<TokenState> {
  const s = await requireSession();
  try {
    const label = String(form.get("label") ?? "");
    const token = await createUploadToken(s.mspId, clientId, label);
    await auditAs(s, "upload_token_created", label.trim(), { clientId });
    revalidatePath(`/app/clients/${clientId}`);
    return { token };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function revokeTokenAction(clientId: string, tokenId: string): Promise<void> {
  const s = await requireSession();
  await revokeUploadToken(s.mspId, tokenId);
  await auditAs(s, "upload_token_revoked", "", { clientId, tokenId });
  revalidatePath(`/app/clients/${clientId}`);
}
