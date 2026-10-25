// Zipax company dashboard: AI coding habits across every developer and
// device the MSP sees.

import type { Metadata } from "next";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import Link from "next/link";
import { allTokens, companyRollup, fmtTokens, fmtUsd, type Rollup } from "@/lib/zipax.ts";
import { GroupTable, RangePicker } from "./_shared.tsx";

export const metadata: Metadata = { title: "Zipax — AI coding habits" };
export const dynamic = "force-dynamic";

export default async function ZipaxCompany({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!hasDatabase()) {
    return (
      <>
        <div className="page-head">
          <h1>Zipax</h1>
          <p className="muted">AI coding habits across your team. Not available in demo mode.</p>
        </div>
      </>
    );
  }
  const session = await requireSession();
  const q = await searchParams;
  const days = pickDays(q.days);
  const data = await companyRollup(session.mspId, days);
  return (
    <>
      <div className="page-head">
        <h1>Zipax — AI coding habits</h1>
        <p className="muted">
          How your developers use AI coding tools over the last {days} days. Numbers only — Zipax never
          collects prompts or code.
        </p>
        <RangePicker days={days} base="/app/zipax" />
        <p className="muted small">
          <Link href="/app/zipax/leaderboard">Company leaderboard</Link> ·{" "}
          <Link href="/app/zipax/team">Team profile (anonymous)</Link>
        </p>
      </div>

      <TopTiles data={data} />

      <section className="panel">
        <div className="panel-head">
          <h2>By tool</h2>
        </div>
        <GroupTable
          rows={data.byTool}
          nameHeader="Tool"
          emptyMsg="No AI tool usage reported yet."
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>By developer</h2>
        </div>
        <GroupTable
          rows={data.byUser}
          nameHeader="Developer"
          emptyMsg="No developers have reported yet."
          linkBase="/app/zipax/dev"
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>By project</h2>
        </div>
        <GroupTable
          rows={data.byProject}
          nameHeader="Project"
          emptyMsg="No projects reported yet."
        />
      </section>
    </>
  );
}

function pickDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

function TopTiles({ data }: { data: Rollup }) {
  const total = allTokens(data.totals);
  const topTool = data.byTool[0];
  const topProject = data.byProject[0];
  const topUser = data.byUser[0];
  return (
    <section className="tiles">
      <Tile label="Total tokens" value={fmtTokens(total)} sub={fmtUsd(data.totals.costUsdCents)} />
      <Tile label="Messages" value={fmtTokens(data.totals.messages)} />
      <Tile label="Top tool" value={topTool?.label ?? "—"} sub={topTool ? fmtTokens(allTokens(topTool.totals)) : ""} />
      <Tile label="Top developer" value={topUser?.label ?? "—"} sub={topUser ? fmtTokens(allTokens(topUser.totals)) : ""} />
      <Tile label="Top project" value={topProject?.label ?? "—"} sub={topProject ? fmtTokens(allTokens(topProject.totals)) : ""} />
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <span className="muted">{sub}</span> : null}
    </div>
  );
}

