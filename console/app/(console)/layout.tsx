import type { Metadata } from "next";
import Link from "next/link";
import { MSP_NAME } from "@/lib/sample-data.ts";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession } from "@/lib/session.ts";
import { signOutAction } from "@/app/(site)/login/actions.ts";
import { Logo } from "@/components/Logo.tsx";

export const metadata: Metadata = { title: "Console" };
// Pages depend on the session and on DATABASE_URL at run time, never at build time.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const demo = !hasDatabase();
  const session = demo ? null : await currentSession();
  return (
    <>
      {demo && <div className="demo-banner">Demo with made-up sample data. Nothing here connects to a real company.</div>}
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/app" className="brand">
            <Logo size={22} />
            Zinloop
          </Link>
          {(demo || session) && (
            <nav className="nav" aria-label="Main">
              <Link href="/app">Clients</Link>
              <Link href="/app/people">People</Link>
              <Link href="/app/tools">AI tools</Link>
              <Link href="/app/import">Open a scan file</Link>
              {session && <Link href="/app/settings">Settings</Link>}
            </nav>
          )}
          {demo && <span className="msp">Signed in as {MSP_NAME}</span>}
          {session && (
            <form action={signOutAction} className="msp">
              {session.mspName} · {session.email}{" "}
              <button type="submit" className="link-btn">Sign out</button>
            </form>
          )}
        </div>
      </header>
      <main className="console-main">{children}</main>
    </>
  );
}
