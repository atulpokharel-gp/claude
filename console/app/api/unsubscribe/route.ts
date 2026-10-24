// POST /api/unsubscribe?t=...  Turns off one kind of email for the signed user.
// Used by the unsubscribe page's button and by mail apps' one-click unsubscribe
// (RFC 8058). GET does nothing, so link scanners can't unsubscribe anyone.

import { NextResponse } from "next/server";
import { unsubscribe } from "@/lib/accounts.ts";
import { hasAppSecret, verifySigned } from "@/lib/crypto.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  let t = url.searchParams.get("t") ?? undefined;
  const form = (req.headers.get("content-type") ?? "").includes("form") ? await req.formData().catch(() => null) : null;
  if (!t && form) t = String(form.get("t") ?? "") || undefined;
  const v = hasAppSecret() ? verifySigned<{ u: string; k: "alert" | "weekly" }>("unsub", t) : null;
  const ok = v && (v.k === "alert" || v.k === "weekly") ? (await unsubscribe(v.u, v.k)) !== null : false;
  // The page's button sends from=page and gets the result page back; mail apps get a plain answer.
  if (form?.get("from") === "page") {
    const base = (process.env.CONSOLE_URL ?? url.origin).replace(/\/+$/, "");
    return NextResponse.redirect(`${base}/unsubscribe?${ok ? `done=${v!.k}` : "failed=1"}`, 303);
  }
  return new NextResponse(ok ? "Unsubscribed." : "This link is not valid.", { status: ok ? 200 : 400 });
}
