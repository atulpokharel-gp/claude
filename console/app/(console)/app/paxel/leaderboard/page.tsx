// Company leaderboard inside the MSP console. Lists every developer the
// MSP's row-level security lets this session see, ranked by their Paxel
// builder-profile overall score. No opt-in required — this is the
// internal view.

import type { Metadata } from "next";
import Link from "next/link";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  type Dimension,
  type LeaderboardRow,
  readCompanyLeaderboard,
} from "@/lib/paxel.ts";
import { RangePicker } from "../_shared.tsx";

export const metadata: Metadata = { title: "Paxel — Company leaderboard" };
export const dynamic = "force-dynamic";

export default async function CompanyLeaderboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; dim?: string }>;
}) {
  if (!hasDatabase()) {
    return (
      <>
        <div className="page-head">
          <h1>Company leaderboard</h1>
          <p className="muted">Not available in demo mode.</p>
        </div>
      </>
    );
  }
  const session = await requireSession();
  const q = await searchParams;
  const days = pickDays(q.days);
  const dim = pickDim(q.dim);
  const rows = await readCompanyLeaderboard(session.mspId, days, 200);
  const ranked = sortByDim(rows, dim);
  return (
    <>
      <div className="page-head">
        <h1>Company leaderboard</h1>
        <p className="muted">
          Every developer in your tenant, ranked by builder-profile score over the last {days} days.
          Scores come from each laptop's own coding sessions — no opt-in required for this view.
        </p>
        <RangePicker days={days} base="/app/paxel/leaderboard" />
        <DimPicker current={dim} days={days} base="/app/paxel/leaderboard" />
      </div>
      <section className="panel">
        <div className="panel-body">
          {ranked.length === 0 ? (
            <p className="empty">
              No builder profiles reported yet. Have a developer run <code>zinloop paxel</code> on
              their laptop.
            </p>
          ) : (
            <LeaderboardTable rows={ranked} activeDim={dim} linkBase="/app/paxel/dev" />
          )}
        </div>
      </section>
    </>
  );
}

function LeaderboardTable({
  rows,
  activeDim,
  linkBase,
}: {
  rows: LeaderboardRow[];
  activeDim: Dimension | "overall";
  linkBase: string;
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
              <Link href={`${linkBase}/${encodeURIComponent(r.userHash)}`}>{r.displayName}</Link>
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

function DimPicker({
  current,
  days,
  base,
}: {
  current: Dimension | "overall";
  days: number;
  base: string;
}) {
  const options: { value: Dimension | "overall"; label: string }[] = [
    { value: "overall", label: "Overall" },
    ...DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABEL[d] })),
  ];
  const href = (v: Dimension | "overall") => {
    const parts: string[] = [];
    if (v !== "overall") parts.push(`dim=${v}`);
    if (days !== 30) parts.push(`days=${days}`);
    return parts.length ? `${base}?${parts.join("&")}` : base;
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
