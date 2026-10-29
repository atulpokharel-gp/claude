import Link from "next/link";
import { ScanConsole } from "@/components/site/ScanConsole.tsx";
import { CtaBand } from "@/components/site/CtaBand.tsx";

export default function Home() {
  return (
    <>
      {/* Product-forward dark hero: the scan is the hero. */}
      <section className="hero-dark">
        <div className="hero-glow" aria-hidden="true" />
        <div className="wrap row center hero-grid">
          <div className="col stack" style={{ gap: 24, flexBasis: 520 }}>
            <p className="eyebrow">For managed service providers</p>
            <h1 className="disp h1">
              See every AI connector your clients&apos; staff plugged in<span className="accent">.</span>
            </h1>
            <p className="lead">
              Zinloop finds AI assistants and MCP connectors across your clients&apos; laptops, flags the ones with
              passwords in plain text, and shows you a plain-English report in one console. Read-only until you decide
              to fix something.
            </p>
            <div className="buttons">
              <Link className="zbtn zbtn-main" href="/free-scan">Start a free scan</Link>
              <Link className="zbtn zbtn-ghost" href="/how-it-works">See how it works</Link>
            </div>
            <ul className="trust" aria-label="At a glance">
              <li><b>15 min</b><span>From sign-up to first finding</span></li>
              <li><b>Read-only</b><span>Nothing changes on a laptop until you say so</span></li>
              <li><b>Keys stay local</b><span>Values are masked on the laptop before sending</span></li>
            </ul>
          </div>
          <div className="col" style={{ flexBasis: 460 }}>
            <ScanConsole />
          </div>
        </div>

        {/* Live-readout strip: what one scan surfaces. */}
        <div className="wrap">
          <ul className="readout" aria-label="What one scan surfaces">
            <li><b>11</b><span>AI connectors found on a typical laptop</span></li>
            <li><b className="hot">9</b><span>high-risk, with a one-command fix</span></li>
            <li><b>3</b><span>apps checked: Claude, Cursor, VS Code</span></li>
            <li><b>0</b><span>key values ever sent to us</span></li>
          </ul>
        </div>
      </section>

      <section className="band section">
        <div className="wrap stack" style={{ gap: 40 }}>
          <div className="head">
            <p className="eyebrow">The problem</p>
            <h2 className="disp h2">Every AI connector is a new door into the business. Nobody is checking the locks.</h2>
          </div>
          <div className="grid3">
            <div className="ruled">
              <h3>Keys sit in plain text</h3>
              <p className="body">AI apps read their connections from files on the laptop. Database passwords and API tokens get pasted straight in, where malware, backups and synced folders can copy them.</p>
            </div>
            <div className="ruled">
              <h3>Code nobody vetted</h3>
              <p className="body">Connectors install from npm or GitHub with one line and run with the user&apos;s full access. Many pull a new version every time they start.</p>
            </div>
            <div className="ruled">
              <h3>No list, no owner</h3>
              <p className="body">Your RMM and antivirus see a process, not an AI agent with access to payroll. When a client asks how they control AI, there&apos;s nothing to show them.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap stack" style={{ gap: 40 }}>
          <div className="head">
            <p className="eyebrow">Your first 15 minutes</p>
            <h2 className="disp h2">Sign up, add a client, run the scanner. Findings land in your console.</h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div>
                <h3>Create your account</h3>
                <p className="body">Work email and a password. No card. You&apos;re the owner of the workspace; invite techs later.</p>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <h3>Add a client, grab its upload token</h3>
                <p className="body">The token is scoped to that one client. Put it in your RMM as an environment variable alongside your console URL.</p>
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <h3>Install the scanner on a laptop</h3>
                <p className="body">One line of PowerShell on Windows, one line of shell on macOS or Linux. Scripts are signed and the binaries are checksummed.</p>
              </div>
            </li>
            <li>
              <span className="step-num">4</span>
              <div>
                <h3>Read the first findings</h3>
                <p className="body">The console groups them by severity, points at the exact config file, and shows a one-command fix. You decide what to apply.</p>
              </div>
            </li>
          </ol>
          <p><Link href="/how-it-works">Read the full walkthrough →</Link></p>
        </div>
      </section>

      <section className="band section">
        <div className="wrap row">
          <div className="col stack">
            <p className="eyebrow">Built for MSPs</p>
            <h2 className="disp h2">A new line item that pays for itself at one client</h2>
            <p className="body">
              Clients are already asking about AI risk, and so are their insurers. Zinloop gives you something concrete
              to sell: a scan, a fix, and a monthly report that shows exposed keys going down.
            </p>
            <p><Link href="/msps">See the partner program →</Link></p>
          </div>
          <div className="col card lifted">
            <p className="eyebrow">Margin example · 50-laptop client</p>
            <div className="money">
              <span>Your cost</span><span className="r">$100 / month</span>
              <span>You charge the client ($5–8 per laptop)</span><span className="r">$250–400 / month</span>
              <span className="total">Your margin</span><span className="total r">$150–300 / month</span>
            </div>
            <p className="small">Suggested resale range. You set your own price.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap row">
          <div className="col stack">
            <p className="eyebrow">Security</p>
            <h2 className="disp h2">We never see your clients&apos; keys</h2>
            <p className="body">
              The scanner reports where a secret is and what kind it is. The value is masked on the laptop before
              anything is sent. Read-only by default — nothing changes on a laptop until a technician runs a fix.
            </p>
            <p><Link href="/security">How we handle data →</Link></p>
          </div>
          <div className="col grid2">
            <div className="ruled"><h3>Per-client upload tokens</h3><p className="body">Scoped and revocable. One leaked token exposes one client, not the fleet.</p></div>
            <div className="ruled"><h3>Walled off per MSP</h3><p className="body">Database-level isolation. One MSP never sees another&apos;s data.</p></div>
            <div className="ruled"><h3>Open-source scanner</h3><p className="body">Read what it does before you run it. Builds are checksummed.</p></div>
            <div className="ruled"><h3>No agent on the laptop</h3><p className="body">It runs on a schedule and exits. Nothing listens on a port.</p></div>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
