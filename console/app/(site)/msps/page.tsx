import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/site/CtaBand.tsx";

export const metadata: Metadata = { title: "For MSPs" };

export default function Msps() {
  return (
    <>
      <section className="section">
        <div className="wrap stack" style={{ gap: 20, maxWidth: 900 }}>
          <p className="eyebrow">Partner program</p>
          <h1 className="disp h1">Built to be resold by MSPs</h1>
          <p className="lead">
            One console for all your clients, a per-laptop price with room for margin, and a rollout that fits the RMM you
            already run.
          </p>
          <div className="buttons">
            <Link className="zbtn zbtn-main" href="/free-scan">Start with a free scan</Link>
            <Link className="zbtn zbtn-ghost" href="/pricing">See pricing</Link>
          </div>
        </div>
      </section>

      <section className="band section">
        <div className="wrap grid3">
          <div className="card">
            <h3>Every client in one place</h3>
            <p className="body">Clients are kept apart in the database itself. Each client has its own upload tokens you can revoke at any time.</p>
          </div>
          <div className="card">
            <h3>Fits your RMM</h3>
            <p className="body">Install scripts for NinjaOne, Datto RMM, N-able and ConnectWise Automate. Set two variables, run once, optionally schedule daily.</p>
          </div>
          <div className="card">
            <h3>Something to show the client</h3>
            <p className="body">A printable report per client, so the conversation about AI risk ends with a number and a plan.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap row">
          <div className="col stack">
            <h2 className="disp h2">How partners sell it</h2>
            <ol className="list">
              <li>Run a free scan on the client most likely to care: one that uses AI tools and handles sensitive data.</li>
              <li>Walk the client through the report. Plain-text keys are the finding that lands.</li>
              <li>Fix the keys with one command per laptop and show the score drop.</li>
              <li>Add Zinloop to your security bundle at $5–8 per laptop and roll it out to the next client.</li>
            </ol>
          </div>
          <div className="col card lifted">
            <p className="eyebrow">Design partners</p>
            <h3>Our first five MSPs get 90 days free</h3>
            <p className="body">You get everything plus a direct line to the founders. We ask for a short call each week and, if it works for you, a case study.</p>
            <Link className="zbtn zbtn-main" href="/free-scan?partner=1">Apply as a design partner</Link>
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
