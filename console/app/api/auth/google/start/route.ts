// POST /api/auth/google/start  (form field mode=signin|signup|link)
// Sends the browser to Google. "link" needs a signed-in user. "signup" creates
// a new account on the callback when the Google account is new.

import { NextResponse } from "next/server";
import { hasAppSecret } from "@/lib/crypto.ts";
import { hasGoogleSso, startSignIn } from "@/lib/google-sso.ts";
import { currentSession } from "@/lib/session.ts";
import { consoleBase, redirectUri, saveFlow } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const base = consoleBase(req);
  const form = await req.formData().catch(() => null);
  const raw = form?.get("mode");
  const mode = raw === "link" ? "link" : raw === "signup" ? "signup" : "signin";
  if (!hasGoogleSso() || !hasAppSecret()) {
    const to = mode === "signup" ? "/free-scan?sso=unavailable" : "/login?sso=unavailable";
    return NextResponse.redirect(`${base}${to}`, 303);
  }
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
