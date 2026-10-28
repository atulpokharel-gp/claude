import { NextRequest, NextResponse } from "next/server";

/**
 * Zipax split-host.
 *
 * The marketing site runs under the `(site)` route group. When it is served
 * from `zipax.zinloop.com` instead of `zinloop.com`, we switch its branding
 * to Zipax (public developer face, dark-only) by setting an `x-zinloop-face`
 * request header the (site) layout reads via `headers()`.
 *
 * We also rewrite `/` on the Zipax host to `/leaderboard` so the landing
 * page there is the public dev leaderboard rather than the MSP home.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isZipax = host.startsWith("zipax.");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-zinloop-face", isZipax ? "zipax" : "security");

  if (isZipax && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/leaderboard";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Skip API routes, Next internals, Vercel preview helpers, and anything with a
// file extension (images, fonts, favicons). The layout only runs for app routes
// so there's no gain in rewriting static assets.
export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
