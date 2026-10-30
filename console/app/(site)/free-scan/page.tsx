import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAppSecret } from "@/lib/crypto.ts";
import { hasDatabase } from "@/lib/db.ts";
import { consumerDomains } from "@/lib/email-domains.ts";
import { hasGoogleSso } from "@/lib/google-sso.ts";
import { currentSession, homeFor } from "@/lib/session.ts";
import { SignUpForm } from "./SignUpForm.tsx";

const SSO_NOTICE: Record<string, string> = {
  failed: "That Google sign-up didn't work. Try again, or create your account with a password below.",
  limited: "Too many attempts. Wait a few minutes and try again.",
  cancelled: "That Google sign-up was cancelled.",
  expired: "That sign-up took too long or was already used. Try again.",
  unavailable: "Signing up with Google isn't set up on this server. Use your email and a password.",
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create a free account" };

export default async function FreeScan({ searchParams }: { searchParams: Promise<{ partner?: string; sso?: string }> }) {
  if (hasDatabase()) {
    const s = await currentSession({ viewer: true });
    if (s) redirect(homeFor(s));
  }
  const { partner, sso } = await searchParams;
  const ssoNotice = SSO_NOTICE[sso ?? ""];
  const domains = hasDatabase() ? [...(await consumerDomains())] : [];
  return (
    <section className="section">
      <div className="wrap row">
        <div className="col stack" style={{ gap: 20, flexBasis: 460 }}>
          <p className="eyebrow">Free account · no card</p>
          <h1 className="disp h1">Start scanning in about 15 minutes.</h1>
          <p className="lead">
            Create your MSP workspace, add your first client, and run the scanner on up to 25 laptops. You keep every
            finding — nothing is shared with anyone else.
          </p>
          <ol className="signup-promise">
            <li>
              <b>Create the workspace</b>
              <span>Work email and a password. You become the owner and invite techs later.</span>
            </li>
            <li>
              <b>Add your first client</b>
              <span>You get a per-client upload token. Scoped to that client, revocable any time.</span>
            </li>
            <li>
              <b>Run the scanner</b>
              <span>One-line install for Windows (PowerShell), macOS and Linux. Push it through your RMM or run it by hand.</span>
            </li>
            <li>
              <b>Read the findings</b>
              <span>The console shows what&apos;s exposed, where, and the one-command fix. You decide what to apply.</span>
            </li>
          </ol>
          <p className="small">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
        <div className="col card strong" style={{ flexBasis: 420 }}>
          {hasDatabase() ? (
            <>
              <h2 className="disp h2" style={{ fontSize: 24, marginBottom: 4 }}>Create your account</h2>
              <p className="small" style={{ marginBottom: 10 }}>Takes about a minute. No card.</p>
              {ssoNotice && <p className="zerror" role="alert" style={{ marginBottom: 10 }}>{ssoNotice}</p>}
              <SignUpForm partner={partner === "1"} domains={domains} />
              {hasGoogleSso() && hasAppSecret() && (
                <>
                  <p className="small" style={{ textAlign: "center", margin: "14px 0 8px", opacity: 0.7 }}>or</p>
                  <form method="post" action="/api/auth/google/start">
                    <input type="hidden" name="mode" value="signup" />
                    <button type="submit" className="zbtn zbtn-ghost" style={{ width: "100%" }}>Sign up with Google</button>
                  </form>
                </>
              )}
            </>
          ) : (
            <p className="body">Sign-up is turned off in this demo. <Link href="/app">Open the demo console</Link> to look around.</p>
          )}
        </div>
      </div>
    </section>
  );
}
