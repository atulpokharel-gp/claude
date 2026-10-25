// Per-developer view inside the client portal. RLS limits every query to
// this client, so a user_hash in another client's data cannot be looked up
// from here.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/session.ts";
import { allTokens, fmtTokens, fmtUsd, type GroupTotal, userRollup } from "@/lib/paxel.ts";

export const metadata: Metadata = { title: "Paxel — Developer" };
export const dynamic = "force-dynamic";

export default async function PortalDev({
  params,
  searchParams,
}: {
  params: Promise<{ user: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const s = await requireViewer();
  const { user } = await params;
  const q = await searchParams;
  const days = pickDays(q.days);
  const userHash = decodeURIComponent(user).toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(userHash)) return notFound();
  const data = await userRollup({ mspId: s.mspId, clientId: s.clientId }, userHash, days);
  const label = data.byUser[0]?.label ?? userHash.slice(0, 10);
  return (
    <>
      <div className="page-head">
        <h1>{label}</h1>
        <p className="muted">AI coding habits for one developer, last {days} days.</p>
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
        <div className="panel-head"><h2>Tools</h2></div>
        <SimpleTable rows={data.byTool} nameHeader="Tool" emptyMsg="Nothing yet." />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Projects</h2></div>
        <SimpleTable rows={data.byProject} nameHeader="Project" emptyMsg="No projects." />
      </section>
    </>
  );
}

function pickDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

function SimpleTable({
  rows,
  nameHeader,
  emptyMsg,
}: {
  rows: GroupTotal<string>[];
  nameHeader: string;
  emptyMsg: string;
}) {
  if (rows.length === 0) return <div className="panel-body"><p className="empty">{emptyMsg}</p></div>;
  return (
    <div className="panel-body">
      <table className="data">
        <thead>
          <tr><th>{nameHeader}</th><th className="num">Tokens</th><th className="num">Messages</th><th className="num">Est. cost</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
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
