// Shared Zipax UI pieces used by /app/zipax and /app/zipax/dev/[user].
// Lives outside the page file because Next.js rejects extra exports from
// a page module.

import Link from "next/link";
import { allTokens, fmtTokens, fmtUsd, type GroupTotal } from "@/lib/zipax.ts";

export function GroupTable({
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
              <td>
                {linkBase ? <Link href={`${linkBase}/${encodeURIComponent(r.key)}`}>{r.label}</Link> : r.label}
              </td>
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

export function RangePicker({ days, base }: { days: number; base: string }) {
  const choices = [7, 30, 90];
  return (
    <div className="range-picker">
      {choices.map((d) => (
        <Link
          key={d}
          href={d === 30 ? base : `${base}?days=${d}`}
          className={d === days ? "range-on" : ""}
          aria-current={d === days ? "page" : undefined}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}
