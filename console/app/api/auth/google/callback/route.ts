// GET /api/auth/google/callback  Google sends the browser back here.

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { MFA_PENDING_SECONDS } from "@/lib/auth.ts";
import { finishSignIn, GoogleSsoError } from "@/lib/google-sso.ts";
import { LinkError, linkGoogle, signInWithGoogle, signUpWithGoogle } from "@/lib/identities.ts";
import { requestInfo } from "@/lib/request-audit.ts";
import { currentSession, MFA_COOKIE, setSessionCookie } from "@/lib/session.ts";
import { consoleBase, redirectUri, takeFlow } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

/** Constant-time string equality. Returns false when either side is empty or lengths differ. */
function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = consoleBase(req);
  const flow = await takeFlow("google");
  const go = (path: string) => NextResponse.redirect(`${base}${path}`, 303);
  if (!flow || !safeEqual(url.searchParams.get("state"), flow.s)) return go("/login?sso=expired");

  const viewer = flow.mode === "link" ? (await currentSession({ viewer: true }))?.role === "viewer" : false;
  const back = flow.mode === "link" ? (viewer ? "/portal/account" : "/app/settings") : flow.mode === "signup" ? "/free-scan" : "/login";
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return go(`${back}?sso=cancelled`);

  let account;
  try {
    account = await finishSignIn(code, flow.v, flow.n, redirectUri(req, "google"));
  } catch (err) {
    if (err instanceof GoogleSsoError) {
      console.error(`Google sign-in failed: ${err.message}`);
      return go(`${back}?sso=failed`);
    }
    throw err;
  }
  const info = await requestInfo();

  if (flow.mode === "link") {
    const s = await currentSession({ viewer: true });
    if (!s || s.userId !== flow.u) return go("/login?sso=expired");
    try {
      await linkGoogle(s, account, info.ip);
    } catch (err) {
      if (err instanceof LinkError) return go(`${back}?sso=taken`);
      throw err;
    }
    return go(`${back}?sso=linked`);
  }

  const r = flow.mode === "signup" ? await signUpWithGoogle(account, info) : await signInWithGoogle(account, info);
  // Signing up with an address that already has an account: send them to sign in.
  if (r.kind === "exists") return go("/login?sso=exists");
  if (r.kind === "not-linked") return go("/login?sso=not-linked");
  if (r.kind === "limited") return go(`${back}?sso=limited`);
  if (r.kind === "wrong") return go(`${back}?sso=failed`);
  if (r.kind === "mfa") {
    (await cookies()).set(MFA_COOKIE, r.pending, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ALLOW_HTTP_COOKIES !== "1",
      path: "/login",
      maxAge: MFA_PENDING_SECONDS,
    });
    return go("/login");
  }
  await setSessionCookie(r.token);
  // A brand-new account lands on the welcome screen; viewers go on to their portal from /app.
  return go(flow.mode === "signup" ? "/app?welcome=1" : "/app");
}
