// POST /api/auth/google/start  (form field mode=signin|link)
// Sends the browser to Google. "link" needs a signed-in user.

import { NextResponse } from "next/server";
import { hasAppSecret } from "@/lib/crypto.ts";
import { hasGoogleSso, startSignIn } from "@/lib/google-sso.ts";
import { currentSession } from "@/lib/session.ts";
import { consoleBase, redirectUri, saveFlow } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const base = consoleBase(req);
  const form = await req.formData().catch(() => null);
  const mode = form?.get("mode") === "link" ? "link" : "signin";
  if (!hasGoogleSso() || !hasAppSecret()) return NextResponse.redirect(`${base}/login?sso=unavailable`, 303);
  let userId: string | undefined;
  if (mode === "link") {
    const s = await currentSession({ viewer: true });
    if (!s) return NextResponse.redirect(`${base}/login`, 303);
    userId = s.userId;
  }
  const start = startSignIn(redirectUri(req, "google"));
  await saveFlow({ s: start.state, n: start.nonce, v: start.verifier, mode, u: userId }, "google");
  return NextResponse.redirect(start.url, 303);
}
