import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession } from "@/lib/session.ts";
import { signOutAction } from "@/app/(site)/login/actions.ts";
import { Logo } from "@/components/Logo.tsx";

export const metadata: Metadata = { title: "Your AI security" };
export const dynamic = "force-dynamic";

// The read-only view for someone at a client company. Pages check the session
// themselves (requireViewer); the layout only draws the frame.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  if (!hasDatabase()) redirect("/app"); // demo mode has no viewer accounts
  const s = await currentSession({ viewer: true });
  const viewer = s?.role === "viewer" ? s : null;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/portal" className="brand">
            <Logo size={22} />
            Zinloop
          </Link>
          {viewer && (
            <nav className="nav" aria-label="Main">
              <Link href="/portal">Overview</Link>
              <Link href="/portal/report">Report</Link>
              <Link href="/portal/account">Your account</Link>
            </nav>
          )}
          {viewer && (
            <form action={signOutAction} className="msp">
              {viewer.clientName} · {viewer.email}{" "}
              <button type="submit" className="link-btn">Sign out</button>
            </form>
          )}
        </div>
      </header>
      <main className="console-main">{children}</main>
    </>
  );
}
