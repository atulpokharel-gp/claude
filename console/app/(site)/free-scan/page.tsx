import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession, homeFor } from "@/lib/session.ts";
import { SignUpForm } from "./SignUpForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Free exposure scan" };

export default async function FreeScan({ searchParams }: { searchParams: Promise<{ partner?: string }> }) {
  if (hasDatabase()) {
    const s = await currentSession({ viewer: true });
    if (s) redirect(homeFor(s));
  }
  const { partner } = await searchParams;
  return (
    <section className="section">
      <div className="wrap row">
        <div className="col stack" style={{ gap: 20 }}>
          <p className="eyebrow">Free exposure scan</p>
          <h1 className="disp h1">See what AI your clients have connected</h1>
          <p className="lead">Create an account, add one client and run the scanner on up to 25 laptops. No card needed.</p>
          <ol className="list">
            <li>Create your account (one minute).</li>
            <li>Add a client and copy its upload token.</li>
            <li>Run the install script through your RMM. Findings show up as each laptop reports.</li>
          </ol>
          <p className="small">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
        <div className="col card strong">
          {hasDatabase() ? (
            <SignUpForm partner={partner === "1"} />
          ) : (
            <p className="body">Sign-up is turned off in this demo. <Link href="/app">Open the demo console</Link> to look around.</p>
          )}
        </div>
      </div>
    </section>
  );
}
