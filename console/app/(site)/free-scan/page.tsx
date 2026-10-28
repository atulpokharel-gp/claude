import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession, homeFor } from "@/lib/session.ts";
import { SignUpForm } from "./SignUpForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create a free account" };

export default async function FreeScan({ searchParams }: { searchParams: Promise<{ partner?: string }> }) {
  if (hasDatabase()) {
    const s = await currentSession({ viewer: true });
    if (s) redirect(homeFor(s));
  }
  const { partner } = await searchParams;
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
              <SignUpForm partner={partner === "1"} />
            </>
          ) : (
            <p className="body">Sign-up is turned off in this demo. <Link href="/app">Open the demo console</Link> to look around.</p>
          )}
        </div>
      </div>
    </section>
  );
}
