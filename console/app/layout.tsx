import type { Metadata } from "next";
import Link from "next/link";
import { MSP_NAME } from "@/lib/sample-data.ts";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession } from "@/lib/session.ts";
import { signOutAction } from "./login/actions.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Guard console",
  description: "See every AI agent and MCP server across your clients, and shut down the risky ones.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = !hasDatabase();
  const session = demo ? null : await currentSession();
  return (
    <html lang="en">
      <body>
        {demo && <div className="demo-banner">Demo with made-up sample data. Nothing here connects to a real company.</div>}
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">AG</span>
              Agent Guard
            </Link>
            {(demo || session) && (
              <nav className="nav" aria-label="Main">
                <Link href="/">Clients</Link>
                <Link href="/import">Open a scan file</Link>
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
        <main>{children}</main>
      </body>
    </html>
  );
}
