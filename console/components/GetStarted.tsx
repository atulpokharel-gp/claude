import Link from "next/link";
import type { Client } from "@/lib/types.ts";

type Props = {
  clients: Client[];
  /** Fires on every render in the welcome state too, so first-time users see it. */
  showAlways?: boolean;
};

/**
 * First-run checklist for the console. Three steps:
 * 1. Add first client   → done when any client exists
 * 2. Install scanner    → done when any device has reported
 * 3. See first findings → done when any agent/MCP finding exists
 *
 * We leave the panel up until the three steps are all done, then it hides on
 * every subsequent sign-in. The `?welcome=1` query forces it to show once,
 * right after sign-up, even before the user has done anything.
 */
export function GetStarted({ clients, showAlways }: Props) {
  const hasClient = clients.length > 0;
  const scanned = clients.reduce((n, c) => n + c.devicesScanned, 0);
  const findings = clients.reduce((n, c) => n + c.agents.length, 0);
  const hasScan = scanned > 0;
  const hasFindings = findings > 0;
  const done = hasClient && hasScan && hasFindings;
  if (done && !showAlways) return null;

  const first = clients[0];
  const firstClientHref = first ? `/app/clients/${first.id}` : "/app/clients/new";

  return (
    <section className="panel onboarding" aria-label="Get started">
      <div className="panel-head">
        <h2>Get your first scan</h2>
        <span className="muted small">Three steps, about 15 minutes.</span>
      </div>
      <ol className="onboarding-steps">
        <li className={hasClient ? "done" : "active"}>
          <Mark done={hasClient} n={1} />
          <div>
            <h3>Add your first client</h3>
            <p className="muted">One client = one upload token, scoped to that client&apos;s laptops. You can add more later.</p>
            {!hasClient && (
              <p><Link className="btn primary" href="/app/clients/new">Add a client</Link></p>
            )}
            {hasClient && first && (
              <p className="muted small">Added <b>{first.name}</b>{clients.length > 1 ? ` and ${clients.length - 1} more` : ""}.</p>
            )}
          </div>
        </li>
        <li className={!hasClient ? "" : hasScan ? "done" : "active"}>
          <Mark done={hasScan} n={2} />
          <div>
            <h3>Install the scanner on a laptop</h3>
            <p className="muted">Open the client, create an upload token, and run the one-line install for Windows, macOS or Linux. Push it through your RMM when you&apos;re ready to roll out.</p>
            {hasClient && !hasScan && (
              <p><Link className="btn primary" href={firstClientHref}>Open {first?.name ?? "the client"} to get the install command</Link></p>
            )}
            {hasScan && (
              <p className="muted small">{scanned.toLocaleString("en-US")} {scanned === 1 ? "laptop has" : "laptops have"} reported in.</p>
            )}
          </div>
        </li>
        <li className={!hasScan ? "" : hasFindings ? "done" : "active"}>
          <Mark done={hasFindings} n={3} />
          <div>
            <h3>Read the first findings</h3>
            <p className="muted">The console groups findings by severity and points at the exact config file, with a one-command fix. You decide what to apply.</p>
            {hasScan && !hasFindings && (
              <p className="muted small">No AI connectors have turned up yet. If that&apos;s a surprise, open the client and check which laptops reported.</p>
            )}
            {hasFindings && first && (
              <p><Link className="btn" href={firstClientHref}>See findings for {first.name}</Link></p>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}

function Mark({ done, n }: { done: boolean; n: number }) {
  if (done) {
    return (
      <span className="onb-mark done" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return <span className="onb-mark" aria-hidden>{n}</span>;
}
