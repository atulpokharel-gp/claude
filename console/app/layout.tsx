import type { Metadata } from "next";
import Link from "next/link";
import { MSP_NAME } from "@/lib/sample-data.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Guard console",
  description: "See every AI agent and MCP server across your clients, and shut down the risky ones.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="demo-banner">Demo with made-up sample data. Nothing here connects to a real company.</div>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">AG</span>
              Agent Guard
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Clients</Link>
              <Link href="/import">Upload a laptop scan</Link>
            </nav>
            <span className="msp">Signed in as {MSP_NAME}</span>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
