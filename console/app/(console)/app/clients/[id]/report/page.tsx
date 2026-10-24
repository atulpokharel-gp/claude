import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClient } from "@/lib/data.ts";
import { buildReport } from "@/lib/report.ts";
import { severityLabel } from "@/lib/risk.ts";
import { PrintButton } from "./PrintButton.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client report" };

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadClient(id);
  if (!detail) notFound();
  const now = detail.demo ? new Date("2026-10-24T09:00:00Z") : new Date();
  const r = buildReport(detail.client, detail.mspName, now);
  return (
    <>
      <div className="no-print actions">
        <Link href={`/app/clients/${id}`} className="small">← Back to {r.clientName}</Link>
        <span style={{ flex: 1 }} />
        <PrintButton />
      </div>
      <article className="report">
        <header className="report-head">
          <p className="report-kicker">AI tools security report</p>
          <h1>{r.clientName}</h1>
          <p className="muted">Prepared by {r.preparedBy} · {longDate(r.date)}</p>
        </header>

        <p className="report-headline">{r.headline}</p>

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
                <li key={a.ruleId}>
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
    </>
  );
}
