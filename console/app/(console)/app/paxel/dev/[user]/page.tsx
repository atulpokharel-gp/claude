// Paxel per-developer page: one developer's AI coding habits, from the MSP
// side. The developer's own personal view lives under /portal/paxel.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { allTokens, fmtTokens, fmtUsd, userRollup } from "@/lib/paxel.ts";
import { GroupTable, RangePicker } from "../../page.tsx";

export const metadata: Metadata = { title: "Paxel — Developer" };
export const dynamic = "force-dynamic";

export default async function PaxelDev({
  params,
  searchParams,
}: {
  params: Promise<{ user: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  if (!hasDatabase()) return notFound();
  const session = await requireSession();
  const { user } = await params;
  const q = await searchParams;
  const days = pickDays(q.days);
  const userHash = decodeURIComponent(user).toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(userHash)) return notFound();
  const data = await userRollup(session.mspId, userHash, days);
  const label = data.byUser[0]?.label ?? userHash.slice(0, 10);
  return (
    <>
      <div className="page-head">
        <h1>{label}</h1>
        <p className="muted">AI coding habits for one developer, last {days} days.</p>
        <RangePicker days={days} base={`/app/paxel/dev/${userHash}`} />
      </div>
      <section className="tiles">
        <div className="tile">
          <span>Total tokens</span>
          <b>{fmtTokens(allTokens(data.totals))}</b>
          <span className="muted">{fmtUsd(data.totals.costUsdCents)}</span>
        </div>
        <div className="tile">
          <span>Messages</span>
          <b>{fmtTokens(data.totals.messages)}</b>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Tools used</h2></div>
        <GroupTable rows={data.byTool} nameHeader="Tool" emptyMsg="Nothing yet." />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Projects</h2></div>
        <GroupTable rows={data.byProject} nameHeader="Project" emptyMsg="No projects yet." />
      </section>
    </>
  );
}

function pickDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}
