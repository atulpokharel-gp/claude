// GET /api/m365/callback: Microsoft sends the client's admin back here twice.
//  1. After the admin consent screen, with the tenant ID (unauthenticated URL
//     parameters) and our signed state.
//  2. After a sign-in to that tenant, with a code. We swap the code for an ID
//     token and only link the tenant once it proves the admin belongs to it.

import { NextResponse } from "next/server";
import { sign, verifySigned } from "@/lib/crypto.ts";
import { GraphError, TENANT_ID, verifyAdmin, verifyUrl } from "@/lib/m365.ts";
import { currentSession } from "@/lib/session.ts";
import { connectM365, syncM365 } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = (process.env.CONSOLE_URL ?? url.origin).replace(/\/+$/, "");
  const redirectUri = `${base}/api/m365/callback`;
  const session = await currentSession();
  const raw = url.searchParams.get("state") ?? undefined;

  // Step 2: the sign-in that proves who controls the tenant.
  const verify = verifySigned<{ m: string; c: string; t: string }>("m365-verify", raw);
  if (verify) {
    if (!session || session.mspId !== verify.m) return NextResponse.redirect(`${base}/app?m365=expired`, 303);
    const back = `${base}/app/clients/${verify.c}`;
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error") || !code) return NextResponse.redirect(`${back}?m365=declined`, 303);
    try {
      await verifyAdmin(verify.t, code, redirectUri);
    } catch (err) {
      const reason = err instanceof GraphError && err.status === 403 ? "not-admin" : "verify-failed";
      return NextResponse.redirect(`${back}?m365=${reason}`, 303);
    }
    await connectM365(session.mspId, verify.c, verify.t);
    const r = await syncM365(session.mspId, verify.c);
    return NextResponse.redirect(`${back}?m365=${"error" in r ? "error" : "connected"}`, 303);
  }

  // Step 1: the admin consent answer. Nothing is saved yet.
  const state = verifySigned<{ m: string; c: string }>("m365", raw);
  // The state ties this answer to the MSP and client that started it.
  if (!state || !session || session.mspId !== state.m) {
    return NextResponse.redirect(`${base}/app?m365=expired`, 303);
  }
  const back = `${base}/app/clients/${state.c}`;
  const tenant = url.searchParams.get("tenant") ?? "";
  if (url.searchParams.get("error") || url.searchParams.get("admin_consent")?.toLowerCase() !== "true" || !TENANT_ID.test(tenant)) {
    return NextResponse.redirect(`${back}?m365=declined`, 303);
  }
  const next = sign("m365-verify", { m: state.m, c: state.c, t: tenant.toLowerCase() }, 15 * 60);
  return NextResponse.redirect(verifyUrl(tenant, next, redirectUri), 303);
}
