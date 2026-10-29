// GET /api/desktop/auth/callback  Google sends the browser back here.
//
// Verifies the OAuth state against the signed flow cookie, swaps the code for an
// ID token (lib/google-sso.ts — the client secret is used here, server-side
// only), mints a signed desktop-session token that carries the identity, and
// redirects the browser to the app's loopback server. The desktop app verifies
// its own `state` round-tripped through `ds`, then stores the token for later
// cloud sync. Identity here is deliberately separate from the MSP console's user
// accounts: a Google sign-in from the desktop app does not grant console access.

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAppSecret, sign, verifySigned } from "@/lib/crypto.ts";
import { finishSignIn, GoogleSsoError } from "@/lib/google-sso.ts";
import { consoleBase } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

const COOKIE = "zl_desktop";
const PATH = "/api/desktop/auth";
const TOKEN_DAYS = 180;

interface DFlow {
  s: string;
  n: string;
  v: string;
  port: number;
  ds: string;
}

function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const base = consoleBase(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: PATH });

  const flow = verifySigned<DFlow>("desktop-flow", raw);
  if (!flow) return new NextResponse("That sign-in has expired. Start again from the Zinloop app.", { status: 400 });

  // Everything after this point ends at the app's loopback server.
  const loop = (params: Record<string, string>) =>
    NextResponse.redirect(`http://127.0.0.1:${flow.port}/?${new URLSearchParams(params)}`, 303);

  if (!safeEqual(url.searchParams.get("state"), flow.s)) return loop({ error: "state", state: flow.ds });

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return loop({ error: url.searchParams.get("error") || "cancelled", state: flow.ds });
  }

  let account;
  try {
    account = await finishSignIn(code, flow.v, flow.n, `${base}/api/desktop/auth/callback`);
  } catch (err) {
    if (err instanceof GoogleSsoError) {
      console.error(`Desktop Google sign-in failed: ${err.message}`);
      return loop({ error: "failed", state: flow.ds });
    }
    throw err;
  }

  if (!hasAppSecret()) return new NextResponse("Server misconfigured.", { status: 503 });
  const token = sign("desktop-session", { sub: account.sub, email: account.label, name: account.name }, TOKEN_DAYS * 24 * 3600);
  return loop({ token, email: account.label, name: account.name, sub: account.sub, state: flow.ds });
}
