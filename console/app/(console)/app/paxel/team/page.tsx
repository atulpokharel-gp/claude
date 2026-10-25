// Company team view: anonymous, aggregate-only builder profile across the
// MSP's whole roster. No names, no individual rows — the privacy promise
// here is that someone looking at this page can see the shape of the team
// but not who is strong at what.

import type { Metadata } from "next";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { teamProfile } from "@/lib/paxel.ts";
import { ProfilePanel } from "@/components/ProfilePanel.tsx";

export const metadata: Metadata = { title: "Paxel — Team profile" };
export const dynamic = "force-dynamic";

export default async function PaxelTeam({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!hasDatabase()) {
    return (
      <>
        <div className="page-head">
          <h1>Paxel — Team profile</h1>
          <p className="muted">Not available in demo mode.</p>
        </div>
      </>
    );
  }
  const s = await requireSession();
  const q = await searchParams;
  const days = pickDays(q.days);
  const { dims, developers } = await teamProfile(s.mspId, days);
  const enough = developers >= 3;
  return (
    <>
      <div className="page-head">
        <h1>Paxel — Team profile</h1>
        <p className="muted">
          Average builder-profile scores across every developer who reported in the last {days} days.
          No individual rows, no names — this view is deliberately anonymous.
        </p>
      </div>
      <section className="tiles">
        <div className="tile">
          <span>Developers reporting</span>
          <b>{developers}</b>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Team averages</h2></div>
        {enough ? (
          <ProfilePanel dims={dims} caption="Averages across the whole team." />
        ) : (
          <div className="panel-body">
            <p className="empty">
              Need at least 3 developers reporting to show team averages. Right now {developers} developer{developers === 1 ? "" : "s"} {developers === 1 ? "has" : "have"} reported.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function pickDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}
