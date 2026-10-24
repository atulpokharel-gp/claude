import type { Metadata } from "next";
import Link from "next/link";
import { hasAppSecret, verifySigned } from "@/lib/crypto.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email settings", referrer: "no-referrer", robots: { index: false } };

const WHAT = { alert: "alerts about new high-risk AI tools", weekly: "the weekly summary" } as const;

export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ t?: string; done?: string; failed?: string }> }) {
  const sp = await searchParams;
  const v = sp.t && hasAppSecret() ? verifySigned<{ u: string; k: keyof typeof WHAT }>("unsub", sp.t) : null;
  return (
    <div className="wrap auth">
      <section className="card strong">
        {sp.done === "alert" || sp.done === "weekly" ? (
          <>
            <h1 className="disp h2">You&apos;re unsubscribed</h1>
            <p className="body">You won&apos;t get {WHAT[sp.done]} any more. You can turn it back on in your settings after you <Link href="/login">sign in</Link>.</p>
          </>
        ) : v && WHAT[v.k] ? (
          <>
            <h1 className="disp h2">Stop {WHAT[v.k]}?</h1>
            <p className="body">Your other Zinloop emails aren&apos;t affected.</p>
            <form method="post" action="/api/unsubscribe">
              <input type="hidden" name="t" value={sp.t} />
              <input type="hidden" name="from" value="page" />
              <button type="submit" className="zbtn zbtn-main">Unsubscribe</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="disp h2">This link has expired</h1>
            <p className="body"><Link href="/login">Sign in</Link> and change your email settings there.</p>
          </>
        )}
      </section>
    </div>
  );
}
