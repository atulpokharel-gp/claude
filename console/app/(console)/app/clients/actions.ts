"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { allow } from "@/lib/ratelimit.ts";
import { auditAs } from "@/lib/request-audit.ts";
import { requireSession } from "@/lib/session.ts";
import { createClient, createUploadToken, revokeUploadToken } from "@/lib/store.ts";

export type NewClientState = { error?: string; values?: Record<string, string> };

export async function createClientAction(_prev: NewClientState, form: FormData): Promise<NewClientState> {
  const s = await requireSession();
  const values = Object.fromEntries(["name", "industry", "staff", "devices"].map((k) => [k, String(form.get(k) ?? "")]));
  if (!(await allow("createClient", s.mspId))) {
    return { error: "Too many clients created in the last hour. Try again later.", values };
  }
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
  if (!(await allow("createUploadToken", s.mspId))) {
    return { error: "Too many tokens created in the last hour. Try again later." };
  }
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
  // Audit the token's actual client, not whichever the caller passed. The
  // RLS tenant check still restricts this to the signed-in MSP, so the
  // worst case is a mislabelled audit entry — but we remove even that.
  const actualClientId = await revokeUploadToken(s.mspId, tokenId);
  const target = actualClientId ?? clientId;
  await auditAs(s, "upload_token_revoked", "", { clientId: target, tokenId });
  revalidatePath(`/app/clients/${target}`);
  if (target !== clientId) revalidatePath(`/app/clients/${clientId}`);
}
