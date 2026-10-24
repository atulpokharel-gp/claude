import Link from "next/link";
import { Logo } from "@/components/Logo.tsx";
import "./site.css";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="site-brand">
            <Logo />
            <span className="disp">Zinloop Security</span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link className="hide-sm" href="/how-it-works">How it works</Link>
            <Link className="hide-sm" href="/msps">For MSPs</Link>
            <Link className="hide-sm" href="/security">Security</Link>
            <Link className="hide-sm" href="/pricing">Pricing</Link>
            <Link className="hide-sm" href="/docs">Docs</Link>
            <Link href="/login">Sign in</Link>
            <Link className="zbtn zbtn-main" href="/free-scan">Get a free scan</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <span>© 2026 Zinloop Security</span>
          <nav aria-label="Footer">
            <Link href="/how-it-works">How it works</Link>
            <Link href="/security">Security</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
