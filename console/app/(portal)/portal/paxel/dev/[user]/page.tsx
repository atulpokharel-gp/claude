// Per-developer view inside the client portal. RLS limits every query to
// this client, so a user_hash in another client's data cannot be looked up
// from here.
//
// This page also carries the "share my profile" form: it writes the
// user_hash's public-profile preferences (slug + opt-in dimensions). The
// viewer sees the public URL once the slug is set.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/session.ts";
import {
  allTokens,
  DIMENSION_LABEL,
  DIMENSIONS,
  fmtTokens,
  fmtUsd,
  getPrefs,
  type GroupTotal,
  type ProfilePrefs,
  userProfile,
  userRollup,
} from "@/lib/paxel.ts";
import { ProfilePanel } from "@/components/ProfilePanel.tsx";
import { savePublicProfileAction } from "./actions.ts";

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
  const tenant = { mspId: s.mspId, clientId: s.clientId };
  const [data, profile, prefs] = await Promise.all([
    userRollup(tenant, userHash, days),
    userProfile(tenant, userHash, days),
    getPrefs(tenant, userHash),
  ]);
  const label = data.byUser[0]?.label ?? profile?.userLabel ?? userHash.slice(0, 10);
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
        <div className="panel-head"><h2>Builder profile (private)</h2></div>
        <ProfilePanel
          dims={profile?.dims ?? []}
          caption="Scored on the laptop from local Claude Code sessions. Visible only to signed-in viewers at your company."
        />
      </section>

      <ShareForm userHash={userHash} initial={prefs} displayName={label} />

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

function ShareForm({
  userHash,
  initial,
  displayName,
}: {
  userHash: string;
  initial: ProfilePrefs | null;
  displayName: string;
}) {
  const chosen = new Set(initial?.publicDims ?? []);
  const slug = initial?.publicSlug ?? "";
  const publicUrl = slug ? `/p/${slug}` : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Share a public profile</h2>
      </div>
      <div className="panel-body">
        <p className="muted small">
          Pick which dimensions to show on your public page. Nothing is published until at least one is
          ticked and you save. Toggle them all off (or hit "Turn off") to unpublish.
        </p>
        <form action={savePublicProfileAction} className="form">
          <input type="hidden" name="userHash" value={userHash} />
          <label>
            <span>Display name on the public page</span>
            <input name="displayName" defaultValue={initial?.displayName || displayName} maxLength={120} />
          </label>
          <fieldset className="dim-fieldset">
            <legend>Dimensions to show publicly</legend>
            {DIMENSIONS.map((d) => (
              <label key={d} className="check">
                <input type="checkbox" name="dim" value={d} defaultChecked={chosen.has(d)} />
                <span>{DIMENSION_LABEL[d]}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            <button type="submit">Save &amp; publish</button>
            <button type="submit" name="action" value="disable" className="link-btn">
              Turn off public profile
            </button>
          </div>
        </form>
        {publicUrl ? (
          <p className="muted small">
            Current public URL: <a href={publicUrl}>{publicUrl}</a>{" "}
            — anyone with this link can view the ticked dimensions.
          </p>
        ) : (
          <p className="muted small">No public URL yet. Tick at least one dimension and save to publish.</p>
        )}
      </div>
    </section>
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
