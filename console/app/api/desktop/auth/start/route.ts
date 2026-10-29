// GET /api/desktop/auth/start?port=<loopback>&state=<desktop state>
//
// The Zinloop desktop app opens this URL in the system browser to begin "Sign
// in with Google". It reuses the site's Google OAuth client (lib/google-sso.ts),
// so the client secret stays on the server; the desktop app never sees it.
//
// We stash the PKCE/state values plus the desktop's loopback port and its own
// state in a short-lived signed cookie, then send the browser to Google. The
// callback redirects back to http://127.0.0.1:<port> with a signed identity
// token. Add ${CONSOLE_URL}/api/desktop/auth/callback to the OAuth client's
// "Authorised redirect URIs" in the Google Cloud Console for this to work.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAppSecret, sign } from "@/lib/crypto.ts";
import { hasGoogleSso, startSignIn } from "@/lib/google-sso.ts";
import { consoleBase } from "@/lib/sso-flow.ts";

export const dynamic = "force-dynamic";

const COOKIE = "zl_desktop";
const PATH = "/api/desktop/auth";
const SECONDS = 10 * 60;

export async function GET(req: Request) {
  const base = consoleBase(req);
  const url = new URL(req.url);
  if (!hasGoogleSso() || !hasAppSecret()) {
    return new NextResponse("Sign in with Google isn't set up on this server.", { status: 503 });
  }
  const port = Number(url.searchParams.get("port") || "");
  const dstate = url.searchParams.get("state") || "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return new NextResponse("Bad loopback port.", { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(dstate)) {
    return new NextResponse("Bad state.", { status: 400 });
  }

  const start = startSignIn(`${base}/api/desktop/auth/callback`);
  (await cookies()).set(
    COOKIE,
    sign("desktop-flow", { s: start.state, n: start.nonce, v: start.verifier, port, ds: dstate }, SECONDS),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ALLOW_HTTP_COOKIES !== "1",
      path: PATH,
      maxAge: SECONDS,
    },
  );
  return NextResponse.redirect(start.url, 303);
}
