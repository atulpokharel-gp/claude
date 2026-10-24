import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <section className="section">
      <div className="wrap stack" style={{ gap: 40 }}>
        <div className="head">
          <p className="eyebrow">Pricing</p>
          <h1 className="disp h1">Start free on one client</h1>
          <p className="lead">Billed to the MSP, per laptop scanned in the month. You set the price for your clients.</p>
        </div>
        <div className="grid3">
          <div className="card">
            <h3>Free exposure scan</h3>
            <p className="price">$0</p>
            <p className="body">One client, up to 25 laptops. Keep the findings and the report.</p>
            <Link className="zbtn zbtn-ghost" href="/free-scan">Start a free scan</Link>
          </div>
          <div className="card lifted">
            <h3>MSP</h3>
            <p className="price">$2 <small>per laptop / month</small></p>
            <p className="body">All your clients, the scanner, key fixes, reports and the console. $99 monthly minimum.</p>
            <Link className="zbtn zbtn-main" href="/free-scan">Get started</Link>
          </div>
          <div className="card">
            <h3>Design partner</h3>
            <p className="price">90 days free</p>
            <p className="body">For our first five MSPs: everything, plus a direct line to the founders, in exchange for weekly feedback.</p>
            <Link className="zbtn zbtn-ghost" href="/free-scan?partner=1">Apply</Link>
          </div>
        </div>
        <p className="small">Prices in US dollars, before tax. Paid plans open soon; until then every account runs on the free plan.</p>
      </div>
    </section>
  );
}
