// Public builder-profile leaderboard. Only developers who turned a public
// profile on in /zipax/settings appear here. The scores and ranking are
// computed server-side by the zipax_public_leaderboard SQL function; this
// page never sees prompts, code, tokens, cost, projects or anyone's email.

import type { Metadata } from "next";
import Link from "next/link";
import { hasDatabase } from "@/lib/db.ts";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  type Dimension,
  type LeaderboardRow,
  readPublicLeaderboard,
} from "@/lib/zipax.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Builder profile leaderboard",
  description: "A public ranking of developers by their opt-in Zipax builder profile.",
};

export default async function PublicLeaderboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; dim?: string }>;
}) {
  if (!hasDatabase()) {
    return (
      <div className="wrap narrow">
        <h1>Builder profile leaderboard</h1>
        <p className="muted">Not available in demo mode.</p>
      </div>
    );
  }
  const q = await searchParams;
  const days = pickDays(q.days);
  const dim = pickDim(q.dim);
  const rows = await readPublicLeaderboard(days, 100);
  const ranked = sortByDim(rows, dim);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Builder profile leaderboard</h1>
        <p className="muted">
          Ranks developers by their opt-in Zipax builder-profile scores over the last {days} days.
          Only people who turned a public profile on in{" "}
          <Link href="/zipax/settings">Zipax settings</Link> appear here. Scores are computed on each
          developer's laptop from local coding sessions — no prompts, no code, no project names.
        </p>
        <DimPicker current={dim} days={days} />
      </div>

      {ranked.length === 0 ? (
        <section className="panel">
          <div className="panel-body">
            <p className="empty">
              Nobody has published a profile yet. Run <code>zinloop zipax</code> on your laptop, visit
              the printed <code>/zipax/claim</code> URL, then turn public sharing on in{" "}
              <Link href="/zipax/settings">Zipax settings</Link> to appear here.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-body">
            <LeaderboardTable rows={ranked} activeDim={dim} />
          </div>
        </section>
      )}
    </div>
  );
}

function LeaderboardTable({
  rows,
  activeDim,
}: {
  rows: LeaderboardRow[];
  activeDim: Dimension | "overall";
}) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Developer</th>
          <th className="num">Overall</th>
          {DIMENSIONS.map((d) => (
            <th key={d} className={`num ${d === activeDim ? "active" : ""}`}>{DIMENSION_LABEL[d]}</th>
          ))}
          <th className="num">Sessions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.userHash}>
            <td className="num">{i + 1}</td>
            <td>
              {r.publicSlug ? (
                <Link href={`/p/${r.publicSlug}`}>{r.displayName}</Link>
              ) : (
                <span>{r.displayName}</span>
              )}
            </td>
            <td className="num">
              {r.showMeanScore ? <ScorePill n={r.meanScore} /> : <span className="muted" title="Hidden by the developer">—</span>}
            </td>
            {DIMENSIONS.map((d) => {
              const isPublic = r.publicDims.includes(d);
              const s = r.dimScores[d];
              return (
                <td key={d} className={`num ${d === activeDim ? "active" : ""}`}>
                  {isPublic && typeof s === "number" ? <ScorePill n={s} /> : <span className="muted">—</span>}
                </td>
              );
            })}
            <td className="num">
              {r.showSessions ? r.sessions : <span className="muted" title="Hidden by the developer">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScorePill({ n }: { n: number }) {
  const band = n >= 75 ? "high" : n >= 50 ? "medium" : n >= 25 ? "low" : "none";
  return <span className={`pill ${band}`}>{n}</span>;
}

function DimPicker({ current, days }: { current: Dimension | "overall"; days: number }) {
  const options: { value: Dimension | "overall"; label: string }[] = [
    { value: "overall", label: "Overall" },
    ...DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABEL[d] })),
  ];
  const base = (v: Dimension | "overall") => {
    const parts: string[] = [];
    if (v !== "overall") parts.push(`dim=${v}`);
    if (days !== 30) parts.push(`days=${days}`);
    return parts.length ? `/leaderboard?${parts.join("&")}` : "/leaderboard";
  };
  return (
    <div className="range-picker">
      {options.map((o) => (
        <Link
          key={o.value}
          href={base(o.value)}
          className={o.value === current ? "range-on" : ""}
          aria-current={o.value === current ? "page" : undefined}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function pickDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

function pickDim(raw: string | undefined): Dimension | "overall" {
  if (!raw) return "overall";
  const ok = (DIMENSIONS as readonly string[]).includes(raw);
  return ok ? (raw as Dimension) : "overall";
}

function sortByDim(rows: LeaderboardRow[], dim: Dimension | "overall"): LeaderboardRow[] {
  if (dim === "overall") return rows;
  return [...rows]
    .filter((r) => typeof r.dimScores[dim] === "number")
    .sort((a, b) => (b.dimScores[dim] ?? 0) - (a.dimScores[dim] ?? 0));
}
