/**
 * A faux "live" scan, shown in the landing hero. Pure markup + CSS animation
 * (no client JS, so it stays a server component). Clearly an example: the data
 * mirrors a real zinloop report but is static. Motion is disabled for users who
 * ask for reduced motion (see .scan-console rules in site.css).
 */
import type { CSSProperties } from "react";

type Row = { sev: "high" | "medium" | "low" | "ok"; server: string; app: string; note: string };

const ROWS: Row[] = [
  { sev: "high", server: "stripe", app: "Claude Code", note: "STRIPE_SECRET_KEY in plain text" },
  { sev: "high", server: "postgres", app: "Cursor", note: "container can escape to the host" },
  { sev: "high", server: "internal-wiki", app: "Cursor", note: "unencrypted http:// transport" },
  { sev: "low", server: "sentry", app: "Claude Code", note: "sends data to an outside service" },
  { sev: "ok", server: "local-notes", app: "VS Code", note: "read-only, scoped" },
];

const SEV_LABEL: Record<Row["sev"], string> = { high: "HIGH", medium: "MED", low: "LOW", ok: "CLEAN" };

/** Stagger index for the streaming-in animation (consumed by CSS as `--i`). */
const order = (i: number): CSSProperties => ({ ["--i"]: i } as CSSProperties);

export function ScanConsole() {
  return (
    <figure className="scan-console" aria-label="Example scan report">
      <div className="sc-bar">
        <span className="sc-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="sc-title">zinloop scan · whiteAngel</span>
        <span className="sc-live">
          <span className="sc-pulse" aria-hidden="true" />LIVE
        </span>
      </div>

      <div className="sc-body">
        <p className="sc-cmd" style={order(0)}>
          <span className="sc-prompt">$</span> zinloop scan --all-users
        </p>
        <p className="sc-log" style={order(1)}>
          scanning 11 MCP servers across 3 apps<span className="sc-caret" aria-hidden="true" />
        </p>

        <ul className="sc-rows">
          {ROWS.map((r, i) => (
            <li key={r.server} className="sc-row" style={order(i + 2)}>
              <span className={`sev ${r.sev}`}>{SEV_LABEL[r.sev]}</span>
              <span className="sc-server">{r.server}</span>
              <span className="sc-note">{r.note}</span>
            </li>
          ))}
        </ul>

        <p className="sc-summary" style={order(ROWS.length + 2)}>
          <strong>9 high-risk</strong> · 1 medium · 7 clean across 3 laptops
        </p>
        <pre className="sc-fix" style={order(ROWS.length + 3)}>
          <span className="sc-arrow">▸ one-command fix</span>
          {"\nzinloop fix-secrets --apply"}
        </pre>
      </div>

      <figcaption className="sc-foot">Key values are masked on the laptop and never sent to us.</figcaption>
    </figure>
  );
}
