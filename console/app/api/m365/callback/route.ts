// GET /api/m365/callback: Microsoft sends the client's admin back here after
// the consent screen, with the tenant ID and the state we signed.

import { NextResponse } from "next/server";
import { verifySigned } from "@/lib/crypto.ts";
import { TENANT_ID } from "@/lib/m365.ts";
import { currentSession } from "@/lib/session.ts";
import { connectM365, syncM365 } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = (process.env.CONSOLE_URL ?? url.origin).replace(/\/+$/, "");
  const state = verifySigned<{ m: string; c: string }>("m365", url.searchParams.get("state") ?? undefined);
  const session = await currentSession();
  // The state ties this answer to the MSP and client that started it.
  if (!state || !session || session.mspId !== state.m) {
    return NextResponse.redirect(`${base}/app?m365=expired`, 303);
  }
  const back = `${base}/app/clients/${state.c}`;
  const tenant = url.searchParams.get("tenant") ?? "";
  if (url.searchParams.get("error") || url.searchParams.get("admin_consent")?.toLowerCase() !== "true" || !TENANT_ID.test(tenant)) {
    return NextResponse.redirect(`${back}?m365=declined`, 303);
  }
  await connectM365(session.mspId, state.c, tenant);
  const r = await syncM365(session.mspId, state.c);
  return NextResponse.redirect(`${back}?m365=${"error" in r ? "error" : "connected"}`, 303);
}
