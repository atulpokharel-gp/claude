import type { Metadata } from "next";
import Link from "next/link";
import { MSP_NAME } from "@/lib/sample-data.ts";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession } from "@/lib/session.ts";
import { signOutAction } from "@/app/(site)/login/actions.ts";
import { Logo } from "@/components/Logo.tsx";
import { ConsoleNavigation } from "@/components/ConsoleNavigation.tsx";
import "./console-shell.css";

export const metadata: Metadata = {title:"Zinloop Security Console"};
export const dynamic="force-dynamic";

export default async function ConsoleLayout({children}:{children:React.ReactNode}) {
  const demo=!hasDatabase();
  const session=demo?null:await currentSession();
  return <>
    {demo&&<div className="demo-banner">Demo workspace with synthetic data. No live customer systems are connected.</div>}
    <div className="console-shell">
      <aside className="console-sidebar">
        <Link href="/app" className="brand"><Logo size={30}/><span>Zinloop <span style={{color:"#c9ff3b"}}>Security</span></span></Link>
        {(demo||session)&&<ConsoleNavigation settingsVisible={Boolean(session)}/>}
        <div className="console-sidebar-bottom"><Link href="/app/downloads">Get endpoint scanner →</Link><p>Windows · macOS · Linux<br/>Local-first security scanning</p></div>
      </aside>
      <div className="console-workspace">
        <header className="console-topbar">
          <span className="console-topbar-title">MSP / Security operations</span>
          <div className="console-topbar-right">
            {demo&&<span className="msp">{MSP_NAME} · Demo</span>}
            {session&&<span className="msp">{session.mspName} · {session.email}</span>}
            {session&&<form action={signOutAction}><button type="submit" className="link-btn">Sign out</button></form>}
          </div>
        </header>
        <main className="console-main">{children}</main>
      </div>
    </div>
  </>;
}