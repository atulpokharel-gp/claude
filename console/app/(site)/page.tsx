import Link from "next/link";
import { FindingCard } from "@/components/site/FindingCard.tsx";
import { CtaBand } from "@/components/site/CtaBand.tsx";

export default function Home() {
  return (
    <>
      <section className="section">
        <div className="wrap row center">
          <div className="col stack" style={{ gap: 24, flexBasis: 480 }}>
            <p className="eyebrow">For managed service providers</p>
            <h1 className="disp h1">Your clients' staff plugged AI into the business. Can you see it?</h1>
            <p className="lead">
              Zinloop finds every AI assistant connector on your clients' laptops, flags passwords left in plain text,
              and moves them into the operating system's keychain. Read-only by default. Rolled out through your RMM
              in about 15 minutes.
            </p>
            <div className="buttons">
              <Link className="zbtn zbtn-main" href="/free-scan">Get a free exposure scan</Link>
              <Link className="zbtn zbtn-ghost" href="/how-it-works">See how it works</Link>
              <Link className="zbtn zbtn-ghost" href="/check">Grade your own AI setup</Link>
            </div>
            <p className="small">Works with Claude Desktop, Claude Code, Cursor, VS Code and Windsurf on Windows, macOS and Linux.</p>
          </div>
          <div className="col" style={{ flexBasis: 440 }}>
            <FindingCard />
          </div>
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
              <p className="body">Connectors install from npm or GitHub with one line and run with the user's full access. Many pull a new version every time they start.</p>
            </div>
            <div className="ruled">
              <h3>No list, no owner</h3>
              <p className="body">Your RMM and antivirus see a process, not an AI agent with access to payroll. When a client asks how they control AI, there's nothing to show them.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap stack" style={{ gap: 40 }}>
          <div className="head">
            <p className="eyebrow">How it works</p>
            <h2 className="disp h2">From zero to a client report in an afternoon</h2>
          </div>
          <ol className="grid3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li className="card">
              <span className="step">Step 1</span>
              <h3>Deploy through your RMM</h3>
              <p className="body">Push one small scanner with a per-client upload token. Scripts are ready for NinjaOne, Datto RMM, N-able and ConnectWise Automate.</p>
            </li>
            <li className="card">
              <span className="step">Step 2</span>
              <h3>See every agent, every client</h3>
              <p className="body">One console lists each AI app, connector and stored key across all your clients, with a risk score per client and the laptops that haven't checked in.</p>
            </li>
            <li className="card">
              <span className="step">Step 3</span>
              <h3>Fix it and show the client</h3>
              <p className="body">Move keys into Windows Credential Manager or macOS Keychain with one command, rotate the exposed ones, and hand the client a plain-English report.</p>
            </li>
          </ol>
          <p><Link href="/how-it-works">Read the details →</Link></p>
        </div>
      </section>

      <section className="band section">
        <div className="wrap row">
          <div className="col stack">
            <p className="eyebrow">Built for MSPs</p>
            <h2 className="disp h2">A new security line item your clients will understand</h2>
            <p className="body">
              Clients are already asking about AI risk, and so are their insurers. Zinloop gives you something concrete to
              sell: a scan, a fix, and a report that shows exposed keys going down month after month.
            </p>
            <p><Link href="/msps">See the partner program →</Link></p>
          </div>
          <div className="col card strong">
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
            <h2 className="disp h2">We never see your clients' keys</h2>
            <p className="body">The scanner reports where a secret is and what kind it is. The value is masked on the laptop before anything is sent.</p>
            <p><Link href="/security">How we handle data →</Link></p>
          </div>
          <div className="col grid2">
            <div className="ruled"><h3>Read-only by default</h3><p className="body">Nothing changes on a laptop until a technician runs a fix.</p></div>
            <div className="ruled"><h3>Walled off per MSP</h3><p className="body">The database itself stops one MSP's data from reaching another.</p></div>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
