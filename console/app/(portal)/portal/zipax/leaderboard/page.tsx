// Leaderboard inside the client portal. RLS scopes rows to the signed-in
// viewer's one client, so this is a team ranking rather than a cross-tenant
// one. No opt-in required — the viewer already has permission to see every
// row returned.

import type { Metadata } from "next";
import Link from "next/link";
import { hasDatabase } from "@/lib/db.ts";
import { requireViewer } from "@/lib/session.ts";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  type Dimension,
  type LeaderboardRow,
  readCompanyLeaderboard,
} from "@/lib/zipax.ts";

export const metadata: Metadata = { title: "Zipax — Team leaderboard" };
export const dynamic = "force-dynamic";

export default async function PortalLeaderboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; dim?: string }>;
}) {
  if (!hasDatabase()) {
    return (
      <>
        <div className="page-head">
          <h1>Team leaderboard</h1>
          <p className="muted">Not available in demo mode.</p>
        </div>
      </>
    );
  }
  const s = await requireViewer();
  const q = await searchParams;
  const days = pickDays(q.days);
  const dim = pickDim(q.dim);
  const rows = await readCompanyLeaderboard({ mspId: s.mspId, clientId: s.clientId }, days, 200);
  const ranked = sortByDim(rows, dim);
  return (
    <>
      <div className="page-head">
        <h1>Team leaderboard</h1>
        <p className="muted">
          Everyone on your team, ranked by builder-profile score over the last {days} days. Internal
          view — scores are visible to signed-in people at your company only.
        </p>
        <RangePicker days={days} dim={dim} />
        <DimPicker current={dim} days={days} />
      </div>
      <section className="panel">
        <div className="panel-body">
          {ranked.length === 0 ? (
            <p className="empty">
              No builder profiles yet. Run <code>zinloop zipax</code> on your laptop to appear here.
            </p>
          ) : (
            <LeaderboardTable rows={ranked} activeDim={dim} />
          )}
        </div>
      </section>
    </>
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
          <th>Public?</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.userHash}>
            <td className="num">{i + 1}</td>
            <td>
              <Link href={`/portal/zipax/dev/${encodeURIComponent(r.userHash)}`}>{r.displayName}</Link>
            </td>
            <td className="num"><ScorePill n={r.meanScore} /></td>
            {DIMENSIONS.map((d) => {
              const s = r.dimScores[d];
              return (
                <td key={d} className={`num ${d === activeDim ? "active" : ""}`}>
                  {typeof s === "number" ? <ScorePill n={s} /> : <span className="muted">—</span>}
                </td>
              );
            })}
            <td className="num">{r.sessions}</td>
            <td>
              {r.publicSlug ? (
                <Link href={`/p/${r.publicSlug}`} className="muted small">On</Link>
              ) : (
                <span className="muted small">—</span>
              )}
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

function RangePicker({ days, dim }: { days: number; dim: Dimension | "overall" }) {
  const choices = [7, 30, 90];
  const href = (d: number) => {
    const parts: string[] = [];
    if (d !== 30) parts.push(`days=${d}`);
    if (dim !== "overall") parts.push(`dim=${dim}`);
    return parts.length ? `/portal/zipax/leaderboard?${parts.join("&")}` : "/portal/zipax/leaderboard";
  };
  return (
    <div className="range-picker">
      {choices.map((d) => (
        <Link
          key={d}
          href={href(d)}
          className={d === days ? "range-on" : ""}
          aria-current={d === days ? "page" : undefined}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}

function DimPicker({ current, days }: { current: Dimension | "overall"; days: number }) {
  const options: { value: Dimension | "overall"; label: string }[] = [
    { value: "overall", label: "Overall" },
    ...DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABEL[d] })),
  ];
  const href = (v: Dimension | "overall") => {
    const parts: string[] = [];
    if (v !== "overall") parts.push(`dim=${v}`);
    if (days !== 30) parts.push(`days=${days}`);
    return parts.length ? `/portal/zipax/leaderboard?${parts.join("&")}` : "/portal/zipax/leaderboard";
  };
  return (
    <div className="range-picker">
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
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
