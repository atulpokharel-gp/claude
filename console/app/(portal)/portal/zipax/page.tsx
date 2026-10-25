// Zipax view inside the client portal: AI coding habits at this one client.
// RLS limits every query to the viewer's client, so the same rollup code
// gives a client-scoped view without any extra filter.

import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/session.ts";
import { allTokens, companyRollup, fmtTokens, fmtUsd, type GroupTotal, type Rollup } from "@/lib/zipax.ts";

export const metadata: Metadata = { title: "Zipax — AI coding habits" };
export const dynamic = "force-dynamic";

export default async function PortalZipax({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const s = await requireViewer();
  const q = await searchParams;
  const days = pickDays(q.days);
  const data = await companyRollup({ mspId: s.mspId, clientId: s.clientId }, days);
  return (
    <>
      <div className="page-head">
        <h1>Zipax — AI coding habits</h1>
        <p className="muted">
          How your team uses AI coding tools over the last {days} days. Numbers only — Zipax never
          collects prompts or code.
        </p>
        <RangePicker days={days} />
        <p className="muted small">
          <Link href="/portal/zipax/leaderboard">Team leaderboard</Link>
        </p>
      </div>

      <Tiles data={data} />

      <section className="panel">
        <div className="panel-head"><h2>By tool</h2></div>
        <GroupTable rows={data.byTool} nameHeader="Tool" emptyMsg="No AI tool usage yet." />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>By developer</h2></div>
        <GroupTable
          rows={data.byUser}
          nameHeader="Developer"
          emptyMsg="No developers reporting yet."
          linkBase="/portal/zipax/dev"
        />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>By project</h2></div>
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

function Tiles({ data }: { data: Rollup }) {
  return (
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
      <div className="tile">
        <span>Top tool</span>
        <b>{data.byTool[0]?.label ?? "—"}</b>
      </div>
    </section>
  );
}

function GroupTable({
  rows,
  nameHeader,
  emptyMsg,
  linkBase,
}: {
  rows: GroupTotal<string>[];
  nameHeader: string;
  emptyMsg: string;
  linkBase?: string;
}) {
  if (rows.length === 0) {
    return <div className="panel-body"><p className="empty">{emptyMsg}</p></div>;
  }
  return (
    <div className="panel-body">
      <table className="data">
        <thead>
          <tr>
            <th>{nameHeader}</th>
            <th className="num">Tokens</th>
            <th className="num">Messages</th>
            <th className="num">Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{linkBase ? <Link href={`${linkBase}/${encodeURIComponent(r.key)}`}>{r.label}</Link> : r.label}</td>
              <td className="num">{fmtTokens(allTokens(r.totals))}</td>
              <td className="num">{fmtTokens(r.totals.messages)}</td>
              <td className="num">{fmtUsd(r.totals.costUsdCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangePicker({ days }: { days: number }) {
  const choices = [7, 30, 90];
  return (
    <div className="range-picker">
      {choices.map((d) => (
        <Link
          key={d}
          href={d === 30 ? "/portal/zipax" : `/portal/zipax?days=${d}`}
          className={d === days ? "range-on" : ""}
          aria-current={d === days ? "page" : undefined}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}
