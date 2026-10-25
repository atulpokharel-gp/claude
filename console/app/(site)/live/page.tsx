import type { Metadata } from "next";
import Link from "next/link";
import { readPulse } from "@/lib/pulse.ts";
import { gradeColor, type Grade } from "@/lib/mcp-check.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Live: the state of AI setup security",
  description:
    "Running totals from the free Zinloop AI connector check: how many setups people grade and what grades they get. Updates all day.",
};

// Grades in order so the bar chart reads left to right from best to worst.
const GRADES: Grade[] = ["A", "B", "C", "D", "F"];

export default async function Live() {
  const pulse = await readPulse();
  const checks = pulse.totals.check_run ?? 0;
  const shares = (pulse.totals.share_created ?? 0) + (pulse.totals.share_viewed ?? 0);
  const totalGrades = GRADES.reduce((n, g) => n + (pulse.grades[g] ?? 0), 0);
  const risky = (pulse.grades.C ?? 0) + (pulse.grades.D ?? 0) + (pulse.grades.F ?? 0);
  const riskyPct = totalGrades === 0 ? 0 : Math.round((risky / totalGrades) * 100);
  const maxDay = Math.max(1, ...pulse.dailyChecks.map((d) => d.count));

  return (
    <section className="section">
      <div className="wrap stack" style={{ gap: 40, maxWidth: 980 }}>
        <div className="stack" style={{ gap: 14 }}>
          <p className="eyebrow">Live · last 30 days</p>
          <h1 className="disp h1">The AI setup security pulse</h1>
          <p className="lead">
            Running totals from the free <Link href="/check">AI connector check</Link>. One number per bucket, no
            per-visitor data, no config contents.
          </p>
        </div>

        {totalGrades === 0 ? (
          <p className="body">
            Not enough grades yet to show the breakdown. <Link href="/check">Be the first</Link>.
          </p>
        ) : (
          <>
            <div className="pulse-tiles">
              <div className="pulse-tile">
                <span className="pulse-n">{checks.toLocaleString()}</span>
                <span className="pulse-l">AI setups checked</span>
              </div>
              <div className="pulse-tile">
                <span className="pulse-n">{riskyPct}%</span>
                <span className="pulse-l">had at least one serious risk</span>
              </div>
              <div className="pulse-tile">
                <span className="pulse-n">{shares.toLocaleString()}</span>
                <span className="pulse-l">grades shared or viewed</span>
              </div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <h2 className="disp h2">Grade distribution</h2>
              <ul className="pulse-grades">
                {GRADES.map((g) => {
                  const n = pulse.grades[g] ?? 0;
                  const pct = totalGrades === 0 ? 0 : Math.round((n / totalGrades) * 100);
                  return (
                    <li key={g}>
                      <span className="grade grade-sm" style={{ background: gradeColor[g] }}>{g}</span>
                      <div className="pulse-bar"><span style={{ width: `${pct}%`, background: gradeColor[g] }} /></div>
                      <span className="pulse-pct">{pct}%</span>
                      <span className="pulse-cnt small">{n.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {pulse.dailyChecks.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <h2 className="disp h2">Checks per day (last 14 days)</h2>
                <ol className="pulse-days" aria-label="Checks per day">
                  {pulse.dailyChecks.map((d) => (
                    <li key={d.day} title={`${d.day}: ${d.count}`}>
                      <span className="pulse-day-bar" style={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }} />
                      <span className="small">{d.day.slice(5)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}

        <div className="stack" style={{ gap: 10 }}>
          <h2 className="disp h2">Check yours</h2>
          <p className="lead">Paste your Claude, Cursor or VS Code AI connector config. Nothing is uploaded.</p>
          <div className="buttons">
            <Link className="zbtn zbtn-main" href="/check">Grade my AI setup</Link>
            <Link className="zbtn zbtn-ghost" href="/free-scan">Scan every laptop (free)</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
