import Link from "next/link";
import { loadOverview, loadTrend } from "@/lib/data.ts";
import { attention } from "@/lib/insights.ts";
import { TrendChart } from "@/components/TrendChart.tsx";
import { clientScore, countRisk, keyCounts } from "@/lib/risk.ts";
import { RiskPill } from "@/components/RiskPill.tsx";
import { GetStarted } from "@/components/GetStarted.tsx";

function scoreColor(s: number): string {
  if (s >= 50) return "var(--high)";
  if (s >= 20) return "var(--medium)";
  return "var(--clean)";
}

function timeAgo(iso: string, now: Date): string {
  if (new Date(iso).getTime() <= 0) return "never";
  const h = Math.round((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (h <= 0) return "just now";
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const [{ demo, mspName, clients }, trend] = await Promise.all([loadOverview(), loadTrend(90)]);
  const welcome = (await searchParams).welcome === "1";
  const rows = clients
    .map((c) => ({ c, r: countRisk(c.agents), score: clientScore(c) }))
    .sort((a, b) => b.score - a.score);

  const all = clients.flatMap((c) => c.agents);
  const totals = countRisk(all);
  const devices = clients.reduce((n, c) => n + c.devices, 0);
  const scanned = clients.reduce((n, c) => n + c.devicesScanned, 0);
  const revocable = all.filter((a) => a.revocable && a.findings.some((f) => f.severity === "high")).length;
  const keys = keyCounts(all);
  // The demo data is frozen in time, so measure "ago" from its own clock.
  const now = demo ? new Date("2026-10-24T09:00:00Z") : new Date();
  const todo = attention(clients, now);
  const hasTrend = trend.length >= 2 && trend.some((p) => p.tools > 0);

  return (
    <>
      <div className="page-head">
        <h1>All clients</h1>
        <p className="muted">
          {mspName} · {clients.length} clients · AI agents and MCP servers found in Microsoft 365 and on laptops
        </p>
        {!demo && <Link className="btn" href="/app/clients/new">Add a client</Link>}
      </div>

      {!demo && <GetStarted clients={clients} showAlways={welcome} />}

      {clients.length > 0 && (
        <section className="tiles" aria-label="Summary">
          <div className="tile"><b>{totals.total}</b><span>AI agents and MCP servers found</span></div>
          <div className="tile high"><b>{totals.high}</b><span>high-risk, need action</span></div>
          <div className="tile"><b>{revocable}</b><span>high-risk ones you can revoke in one click</span></div>
          <div className="tile"><b>{devices > 0 ? Math.round((scanned / devices) * 100) : 0}%</b><span>of {devices.toLocaleString("en-US")} devices scanned</span></div>
        </section>
      )}

      {clients.length > 0 && (
        <div className="split">
          <section className="panel">
            <div className="panel-head">
              <h2>Risk over the last 90 days</h2>
              <span className="muted small">High- and medium-risk tools across all clients</span>
            </div>
            {hasTrend ? <TrendChart points={trend} /> : <p className="empty">The chart fills in as laptops report and Microsoft 365 is checked, one point a day.</p>}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Needs attention</h2>
              <span className="muted small">{todo.length === 0 ? "Nothing right now" : `${todo.length} ${todo.length === 1 ? "item" : "items"}`}</span>
            </div>
            {todo.length === 0 ? (
              <p className="empty">Every client is scanned and nothing is high risk.</p>
            ) : (
              <ul className="attention">
                {todo.slice(0, 8).map((t, i) => (
                  <li key={`${t.clientId}-${t.kind}-${i}`} className={`attention-${t.kind}`}>
                    <Link href={`/app/clients/${t.clientId}`}>{t.clientName}</Link>
                    <span>{t.text}</span>
                  </li>
                ))}
                {todo.length > 8 && <li className="muted small">and {todo.length - 8} more below</li>}
              </ul>
            )}
          </section>
        </div>
      )}

      {clients.length > 0 && (
      <section className="panel">
        <div className="panel-head">
          <h2>Passwords and keys in AI tools</h2>
          <span className="muted small">Keys saved in plain text in AI agent configs on laptops</span>
        </div>
        <div className="keys-flow">
          <div><b className="bad">{keys.plain}</b><span>servers with keys in plain text</span><small>Run <code>zinloop fix-secrets --apply</code> on the laptop</small></div>
          <div><b className="warn">{keys.toReplace}</b><span>protected, old key still needs replacing</span><small>Create a new key, then <code>zinloop rotate</code></small></div>
          <div><b className="good">{keys.done}</b><span>servers with all keys protected and replaced</span><small>Nothing to do</small></div>
        </div>
      </section>
      )}

      {clients.length > 0 && (
      <section className="panel">
        <div className="panel-head">
          <h2>Clients by risk</h2>
          <span className="muted small">Riskiest first. Score weighs high findings most and goes up when devices are missing from scans.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Risk score</th>
                <th>Findings</th>
                <th>Agents</th>
                <th>Devices scanned</th>
                <th>Last scan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, r, score }) => (
                <tr key={c.id} className="link-row">
                  <td>
                    <Link className="row-link" href={`/app/clients/${c.id}`}>{c.name}</Link>
                    <div className="muted small">{c.industry} · {c.staff.toLocaleString("en-US")} staff</div>
                  </td>
                  <td>
                    <div className="score" title={`Risk score ${score} of 100`}>
                      <div className="score-track"><div className="score-fill" style={{ width: `${score}%`, background: scoreColor(score) }} /></div>
                      <span className="score-num">{score}</span>
                    </div>
                  </td>
                  <td>
                    <div className="counts">
                      {r.high > 0 && <RiskPill risk="high" count={r.high} />}
                      {r.medium > 0 && <RiskPill risk="medium" count={r.medium} />}
                      {r.high + r.medium === 0 && <RiskPill risk="none" />}
                    </div>
                  </td>
                  <td className="num">{r.total}</td>
                  <td className="num">
                    {c.devicesScanned.toLocaleString("en-US")} / {c.devices.toLocaleString("en-US")}
                  </td>
                  <td className="muted small">{timeAgo(c.lastScan, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </>
  );
}
