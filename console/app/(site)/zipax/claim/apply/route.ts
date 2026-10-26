// GET /zipax/claim/apply?token=... validates the claim token, writes the
// signed `zipax_dev` cookie onto the response, and redirects back to
// /zipax/claim with a status for the UI.
//
// The /zipax/claim page itself is a Server Component and cannot set
// cookies in Next.js 15 — a Route Handler can.

import { NextResponse } from "next/server";
import {
  ZIPAX_DEV_COOKIE,
  zipaxDevCookieMaxAge,
  resolveClaim,
  signDevIdentity,
} from "@/lib/zipax.ts";
import { hasAppSecret } from "@/lib/crypto.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string, uh?: string) => {
    const to = new URL("/zipax/claim", url);
    to.searchParams.set("status", status);
    if (uh) to.searchParams.set("uh", uh);
    return NextResponse.redirect(to, 303);
  };

  if (!hasAppSecret()) return back("misconfigured");

  const token = url.searchParams.get("token");
  if (!token) return back("invalid");

  const id = await resolveClaim(token);
  if (!id) return back("invalid");

  const signed = signDevIdentity(id);
  const res = back("ok", id.userHash);
  res.cookies.set(ZIPAX_DEV_COOKIE, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: zipaxDevCookieMaxAge(),
    path: "/",
  });
  return res;
}
