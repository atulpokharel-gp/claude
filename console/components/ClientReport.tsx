import { buildReport } from "@/lib/report.ts";
import { severityLabel } from "@/lib/risk.ts";
import type { M365Status } from "@/lib/store.ts";
import type { Client } from "@/lib/types.ts";

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** The printable AI tools report for one client, shared by the console and the client portal. */
export function ClientReport({ client, mspName, m365, demo }: { client: Client; mspName: string; m365: M365Status | null; demo: boolean }) {
  const now = demo ? new Date("2026-10-24T09:00:00Z") : new Date();
  const r = buildReport(client, mspName, now);
  // Say plainly whether Microsoft 365 was checked, so an empty list isn't read as "all clear".
  const m = m365;
  let m365Note: string | null = null;
  if (!demo) {
    if (!m) m365Note = "Microsoft 365 is not connected, so only laptops were checked.";
    else if (m.lastError || !m.lastSync) {
      m365Note = `Microsoft 365 could not be checked${m.lastSync ? ` since ${new Date(m.lastSync).toLocaleDateString("en-US", { dateStyle: "long" })}` : ""}, so its results may be missing or out of date.`;
    } else m365Note = `Microsoft 365 was last checked on ${new Date(m.lastSync).toLocaleDateString("en-US", { dateStyle: "long" })}.`;
  }
  return (
    <article className="report">
      <header className="report-head">
        <p className="report-kicker">AI tools security report</p>
        <h1>{r.clientName}</h1>
        <p className="muted">Prepared by {r.preparedBy} · {longDate(r.date)}</p>
      </header>

      <p className="report-headline">{r.headline}</p>
      {m365Note && <p className={m?.lastError || (m && !m.lastSync) ? "report-warning" : "muted"}>{m365Note}</p>}

      <section className="report-figures" aria-label="Summary">
        <div><b>{r.tools}</b><span>AI tools connected</span></div>
        <div><b className={r.high ? "bad" : ""}>{r.high}</b><span>high risk</span></div>
        <div><b className={r.plainKeys ? "bad" : ""}>{r.plainKeys}</b><span>with passwords in plain text</span></div>
        <div><b>{r.laptopsReporting} of {r.laptopsExpected}</b><span>laptops checked this week</span></div>
      </section>

      <section className="report-section">
        <h2>What needs doing</h2>
        {r.actions.length === 0 ? (
          <p>Nothing. Every AI tool found is set up safely.</p>
        ) : (
          <ol className="report-actions">
            {r.actions.map((a) => (
              <li key={`${a.ruleId}:${a.fix}`}>
                <div className="report-action-head">
                  <span className={`pill ${a.severity}`}>{severityLabel(a.severity)}</span>
                  <h3>{a.title}</h3>
                </div>
                <p><b>Found in {a.tools} {a.tools === 1 ? "tool" : "tools"}</b> on {a.places.slice(0, 6).join(", ")}{a.places.length > 6 ? ` and ${a.places.length - 6} more` : ""}.</p>
                <p><b>What we'll do:</b> {a.fix}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {(r.keysProtected > 0 || r.clean.length > 0) && (
        <section className="report-section">
          <h2>Already in good shape</h2>
          {r.keysProtected > 0 && <p>{r.keysProtected} {r.keysProtected === 1 ? "key has" : "keys have"} been moved out of plain text into the computer's secure keychain.</p>}
          {r.clean.length > 0 && <p>No problems found with: {r.clean.join(", ")}.</p>}
        </section>
      )}

      {r.laptopsReporting < r.laptopsExpected && (
        <section className="report-section">
          <h2>Not yet checked</h2>
          <p>
            {r.laptopsExpected - r.laptopsReporting} of {r.laptopsExpected} laptops haven't reported a scan in the last 7 days,
            so this report doesn't cover them yet.
          </p>
        </section>
      )}

      <section className="report-section report-scope">
        <h2>About this report</h2>
        <p>
          AI assistants such as Claude, ChatGPT, Cursor and Copilot can be connected to company systems through small
          programs called connectors, or through access granted in Microsoft 365. This report lists those connections,
          flags the risky ones and says what we'll do about each. The scan reads settings files only. Passwords and keys
          themselves were never collected.
        </p>
      </section>
      <footer className="report-foot muted">Zinloop Security · zinloop.com</footer>
    </article>
  );
}
