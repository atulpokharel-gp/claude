// /paxel/claim?token=... binds a developer's own browser to their
// user_hash. The scanner prints a URL in this shape at the end of its
// first run. Visiting it sets the signed `paxel_dev` cookie; only requests
// carrying that cookie can edit prefs for that user_hash.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  PAXEL_DEV_COOKIE,
  paxelDevCookieMaxAge,
  resolveClaim,
  signDevIdentity,
} from "@/lib/paxel.ts";
import { hasAppSecret } from "@/lib/crypto.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Claim your Paxel profile",
  robots: { index: false, follow: false },
};

export default async function Claim({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!hasAppSecret()) {
    return (
      <div className="wrap narrow">
        <h1>Paxel is not fully configured</h1>
        <p>APP_SECRET is not set on this console, so the claim cookie can't be signed.</p>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="wrap narrow">
        <h1>Claim your Paxel profile</h1>
        <p className="muted">
          This page binds your browser to the user_hash your laptop's Paxel scanner wrote. Run{" "}
          <code>zinloop paxel</code> on your laptop once; the output will include a URL in the shape
          <code>https://zinloop.com/paxel/claim?token=…</code>. Open that URL here.
        </p>
      </div>
    );
  }
  const id = await resolveClaim(token);
  if (!id) {
    return (
      <div className="wrap narrow">
        <h1>Claim link didn't match</h1>
        <p className="muted">
          No developer is bound to that token on this console. Re-run <code>zinloop paxel</code> on
          your laptop — the first run creates the token and uploads its hash.
        </p>
      </div>
    );
  }
  const signed = signDevIdentity(id);
  const jar = await cookies();
  jar.set(PAXEL_DEV_COOKIE, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: paxelDevCookieMaxAge(),
    path: "/",
  });
  return (
    <div className="wrap narrow">
      <h1>You're claimed</h1>
      <p className="muted">
        This browser now controls the public-profile prefs for <code>{id.userHash.slice(0, 10)}…</code>.
        Head to <a href="/paxel/settings">Paxel settings</a> to pick which dimensions to publish and
        see your public URL.
      </p>
    </div>
  );
}
