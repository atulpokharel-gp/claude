// /zipax/claim?token=... binds a developer's own browser to their
// user_hash. The scanner prints a URL in this shape at the end of its
// first run.
//
// A Server Component cannot set cookies in Next.js 15, so when a token
// is present we redirect to /zipax/claim/apply, a Route Handler that
// validates the token, writes the signed `zipax_dev` cookie onto its
// response, and redirects back here with `?status=...` for the UI.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAppSecret } from "@/lib/crypto.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Claim your Zipax profile",
  robots: { index: false, follow: false },
};

export default async function Claim({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string; uh?: string }>;
}) {
  const { token, status, uh } = await searchParams;

  if (token) {
    // Hand off to the Route Handler so the cookie can be set.
    redirect(`/zipax/claim/apply?token=${encodeURIComponent(token)}`);
  }

  if (status === "misconfigured" || !hasAppSecret()) {
    return (
      <div className="wrap narrow">
        <h1>Zipax is not fully configured</h1>
        <p>APP_SECRET is not set on this console, so the claim cookie can't be signed.</p>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="wrap narrow">
        <h1>Claim link didn't match</h1>
        <p className="muted">
          No developer is bound to that token on this console. Re-run <code>zinloop zipax</code> on
          your laptop — the first run creates the token and uploads its hash.
        </p>
      </div>
    );
  }

  if (status === "ok") {
    const short = (uh ?? "").slice(0, 10);
    return (
      <div className="wrap narrow">
        <h1>You're claimed</h1>
        <p className="muted">
          This browser now controls the public-profile prefs for <code>{short}…</code>. Head to{" "}
          <a href="/zipax/settings">Zipax settings</a> to pick which dimensions to publish and see
          your public URL.
        </p>
      </div>
    );
  }

  return (
    <div className="wrap narrow">
      <h1>Claim your Zipax profile</h1>
      <p className="muted">
        This page binds your browser to the user_hash your laptop's Zipax scanner wrote. Run{" "}
        <code>zinloop zipax</code> on your laptop once; the output will include a URL in the shape{" "}
        <code>https://zinloop.com/zipax/claim?token=…</code>. Open that URL here.
      </p>
    </div>
  );
}
