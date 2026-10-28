import { NextRequest, NextResponse } from "next/server";
import { canonicalPublicProfileRedirect } from "@/lib/public-host.ts";

/**
 * Split-host routing for the marketing site.
 *
 * The marketing site runs under the `(site)` route group. We decide its
 * "face" from the request host and tell the (site) layout via the
 * `x-zinloop-face` request header, which it reads with `headers()`:
 *
 *   - `zipax.*`    → Zipax (public developer face, dark-only); `/` is
 *                    rewritten to `/leaderboard`.
 *   - `founder.*`  → Founder (dark, single page); `/` is rewritten to
 *                    `/founder` so a visit to founder.zinloop.com lands
 *                    on the About / story page.
 *   - anything else → the default Zinloop Security face.
 *
 * `/p/<slug>` is a public developer page. Its canonical home is
 * zipax.zinloop.com; a hit on zinloop.com (or any non-Zipax alias) is a 308
 * redirect to the matching URL on zipax.zinloop.com so that a shared link
 * ends up on the Zipax-branded host regardless of where it was pasted from.
 * The redirect decision lives in `canonicalPublicProfileRedirect` so it can
 * be unit-tested without faking a NextRequest.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isZipax = host.startsWith("zipax.");
  const isFounder = host.startsWith("founder.");

  const face = isZipax ? "zipax" : isFounder ? "founder" : "security";
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-zinloop-face", face);

  if (isZipax && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/leaderboard";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  if (isFounder && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/founder";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  const canonical = canonicalPublicProfileRedirect(
    host,
    req.nextUrl.pathname,
    req.nextUrl.search,
  );
  if (canonical) {
    return NextResponse.redirect(canonical, 308);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Skip API routes, Next internals, Vercel preview helpers, and anything with a
// file extension (images, fonts, favicons). The layout only runs for app routes
// so there's no gain in rewriting static assets.
export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
