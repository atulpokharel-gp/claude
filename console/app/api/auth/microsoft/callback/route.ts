// GET /api/auth/microsoft/callback  Microsoft sends the browser back here.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { MFA_PENDING_SECONDS } from "@/lib/auth.ts";
import { LinkError, linkMicrosoft, signInWithMicrosoft } from "@/lib/identities.ts";
import { finishSignIn, SsoError } from "@/lib/microsoft-sso.ts";
import { requestInfo } from "@/lib/request-audit.ts";
import { currentSession, MFA_COOKIE, setSessionCookie } from "@/lib/session.ts";
import { consoleBase, redirectUri, takeFlow } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = consoleBase(req);
  const flow = await takeFlow();
  const go = (path: string) => NextResponse.redirect(`${base}${path}`, 303);
  if (!flow || url.searchParams.get("state") !== flow.s) return go("/login?sso=expired");

  const viewer = flow.mode === "link" ? (await currentSession({ viewer: true }))?.role === "viewer" : false;
  const back = flow.mode === "link" ? (viewer ? "/portal/account" : "/app/settings") : "/login";
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return go(`${back}?sso=cancelled`);

  let account;
  try {
    account = await finishSignIn(code, flow.v, flow.n, redirectUri(req));
  } catch (err) {
    if (err instanceof SsoError) {
      console.error(`Microsoft sign-in failed: ${err.message}`);
      return go(`${back}?sso=failed`);
    }
    throw err;
  }
  const info = await requestInfo();

  if (flow.mode === "link") {
    const s = await currentSession({ viewer: true });
    if (!s || s.userId !== flow.u) return go("/login?sso=expired");
    try {
      await linkMicrosoft(s, account, info.ip);
    } catch (err) {
      if (err instanceof LinkError) return go(`${back}?sso=taken`);
      throw err;
    }
    return go(`${back}?sso=linked`);
  }

  const r = await signInWithMicrosoft(account, info);
  if (r.kind === "not-linked") return go("/login?sso=not-linked");
  if (r.kind === "limited") return go("/login?sso=limited");
  if (r.kind === "wrong") return go("/login?sso=failed");
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
  // Viewers are sent on to their portal from /app.
  return go("/app");
}
