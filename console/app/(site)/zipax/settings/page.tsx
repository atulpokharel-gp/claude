// /zipax/settings — the self-serve home for a Zipax developer. Only the
// zipax_dev cookie decides who you are here: no MSP or portal login is
// required (the dev may not be a user in the console at all). From this
// page a dev picks every bit of public exposure: whether a public profile
// exists, under which URL, which dimension scores show on it, whether
// they appear on the leaderboard, whether their display name is shown or
// an anonymous label, whether the overall mean and session counts are
// shown. Private-by-default: everything the dev doesn't tick stays
// internal to their tenant.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db.ts";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  getPrefs,
  ZIPAX_DEV_COOKIE,
  type ProfilePrefs,
  readDevIdentity,
  userProfile,
} from "@/lib/zipax.ts";
import { ProfilePanel } from "@/components/ProfilePanel.tsx";
import { saveZipaxSettingsAction, signOutZipaxDevAction } from "./actions.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Zipax settings",
  robots: { index: false, follow: false },
};

export default async function ZipaxSettings() {
  const jar = await cookies();
  const dev = readDevIdentity(jar.get(ZIPAX_DEV_COOKIE)?.value);
  if (!dev) return <NotClaimed />;

  const tenant = { mspId: dev.mspId, clientId: dev.clientId };
  // zipax_dev cookie is signed; the resolver only hands back ids that
  // zipax_resolve_claim returned, so the mspId + clientId pair is already
  // verified. withTenant adds RLS as defence in depth.
  const [prefs, profile, client] = await Promise.all([
    getPrefs(tenant, dev.userHash),
    userProfile(tenant, dev.userHash, 30),
    withTenant(tenant, async (db) =>
      (await db.query<{ name: string }>("select name from clients where id = $1", [dev.clientId])).rows[0],
    ),
  ]);

  const displayName = prefs?.displayName || profile?.userLabel || dev.userHash.slice(0, 10);
  const publicUrl = prefs?.publicSlug ? `/p/${prefs.publicSlug}` : null;

  return (
    <div className="wrap narrow">
      <div className="page-head">
        <h1>Zipax settings</h1>
        <p className="muted">
          Signed in as <code>{dev.userHash.slice(0, 10)}…</code>
          {client ? <> at <b>{client.name}</b></> : null}.{" "}
          <form action={signOutZipaxDevAction} className="inline-form">
            <button type="submit" className="link-btn" aria-label="Sign out of this browser's claim">
              Sign out of this browser
            </button>
          </form>
        </p>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Your builder profile (private)</h2></div>
        <ProfilePanel
          dims={profile?.dims ?? []}
          caption="Scored on the laptop from local Claude Code sessions. Private unless you turn public sharing on below."
        />
      </section>

      <ShareForm initial={prefs} fallbackName={displayName} />

      {publicUrl ? (
        <section className="panel">
          <div className="panel-head"><h2>Your public URL</h2></div>
          <div className="panel-body">
            <p>
              <a href={publicUrl}>{publicUrl}</a> — anyone with this link can view what you've ticked
              below. No tokens, cost, projects or messages are shown there.
            </p>
            <p className="muted small">
              You'll appear on the <a href="/leaderboard">public leaderboard</a> only when "List me on
              the public leaderboard" is on and at least one dimension score is published. To stop
              sharing entirely, press "Turn off public profile".
            </p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><h2>Regenerating this browser's claim</h2></div>
        <div className="panel-body">
          <p className="muted small">
            This browser is bound to your laptop via a signed cookie. If you lose the laptop or want
            to move to a new browser, run <code>zinloop zipax</code> again on the laptop you want to
            keep — the output always includes a fresh{" "}
            <code>https://zinloop.com/zipax/claim?token=…</code> URL. Open it in the browser you want
            to bind. The token file on the laptop stays the same unless you delete{" "}
            <code>~/.zinloop/zipax-claim-token</code>; deleting it makes the next run issue a new
            token and new URL, which invalidates every browser signed in with the old one.
          </p>
        </div>
      </section>
    </div>
  );
}

function ShareForm({ initial, fallbackName }: { initial: ProfilePrefs | null; fallbackName: string }) {
  const chosen = new Set(initial?.publicDims ?? []);
  const isOn = Boolean(initial?.publicSlug) && chosen.size > 0;
  // Defaults for a brand-new publish: show the display name, show overall
  // and sessions, and stay off the leaderboard. Everything the dev leaves
  // untouched is explicitly private.
  const leaderboardOptIn = initial?.leaderboardOptIn ?? false;
  const showDisplayName = initial?.showDisplayName ?? true;
  const showMeanScore = initial?.showMeanScore ?? true;
  const showSessions = initial?.showSessions ?? true;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Public profile {isOn ? <span className="pill on">On</span> : <span className="pill off">Off</span>}</h2>
      </div>
      <div className="panel-body">
        <p className="muted small">
          Pick exactly what shows publicly. Nothing is published until at least one dimension is
          ticked and you save. Everything you leave unticked stays private to you and your
          company.
        </p>
        <form action={saveZipaxSettingsAction} className="form">
          <label>
            <span>Display name</span>
            <input name="displayName" defaultValue={initial?.displayName || fallbackName} maxLength={120} />
            <span className="muted small">
              Shown on your public page and the leaderboard only when "Show my display name" is on
              below.
            </span>
          </label>

          <fieldset className="dim-fieldset">
            <legend>Dimension scores to show publicly</legend>
            {DIMENSIONS.map((d) => (
              <label key={d} className="check">
                <input type="checkbox" name="dim" value={d} defaultChecked={chosen.has(d)} />
                <span>{DIMENSION_LABEL[d]}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="dim-fieldset">
            <legend>What else shows</legend>
            <label className="check">
              <input
                type="checkbox"
                name="leaderboardOptIn"
                defaultChecked={leaderboardOptIn}
              />
              <span>
                List me on the public leaderboard
                <span className="muted small"> — off by default. When off, your /p/{"{slug}"} page still works for people with the link.</span>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="showDisplayName"
                defaultChecked={showDisplayName}
              />
              <span>
                Show my display name
                <span className="muted small"> — off replaces it with "Anonymous developer" on both the profile page and the leaderboard.</span>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="showMeanScore"
                defaultChecked={showMeanScore}
              />
              <span>
                Show my overall score
                <span className="muted small"> — off hides the Overall column on the leaderboard for your row.</span>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="showSessions"
                defaultChecked={showSessions}
              />
              <span>
                Show my sessions count
                <span className="muted small"> — off hides "N sessions over the last 30 days" on the profile page and the Sessions column on the leaderboard.</span>
              </span>
            </label>
          </fieldset>

          <div className="form-actions">
            <button type="submit">Save &amp; publish</button>
            <button type="submit" name="action" value="disable" className="link-btn">
              Turn off public profile
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function NotClaimed() {
  return (
    <div className="wrap narrow">
      <h1>Zipax settings</h1>
      <p className="muted">
        This browser isn't signed in to any Zipax developer identity yet. Run{" "}
        <code>zinloop zipax</code> on your laptop once — the end of the output prints a URL in the
        shape <code>https://zinloop.com/zipax/claim?token=…</code>. Open that URL in this browser,
        then come back here.
      </p>
      <p className="muted small">
        You never need an MSP or portal login to manage your own Zipax profile. The signed cookie
        this flow sets is scoped to <code>zipax_dev</code> only.
      </p>
    </div>
  );
}
