// /paxel/settings — the self-serve home for a Paxel developer. Only the
// paxel_dev cookie decides who you are here: no MSP or portal login is
// required (the dev may not be a user in the console at all). From this
// page a dev can turn their public profile on or off, pick the dimensions
// to publish, change their display name, see the public URL, and sign out
// of this browser's claim.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db.ts";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  getPrefs,
  PAXEL_DEV_COOKIE,
  type ProfilePrefs,
  readDevIdentity,
  userProfile,
} from "@/lib/paxel.ts";
import { ProfilePanel } from "@/components/ProfilePanel.tsx";
import { savePaxelSettingsAction, signOutPaxelDevAction } from "./actions.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Paxel settings",
  robots: { index: false, follow: false },
};

export default async function PaxelSettings() {
  const jar = await cookies();
  const dev = readDevIdentity(jar.get(PAXEL_DEV_COOKIE)?.value);
  if (!dev) return <NotClaimed />;

  const tenant = { mspId: dev.mspId, clientId: dev.clientId };
  // paxel_dev cookie is signed; the resolver only hands back ids that
  // paxel_resolve_claim returned, so the mspId + clientId pair is already
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
        <h1>Paxel settings</h1>
        <p className="muted">
          Signed in as <code>{dev.userHash.slice(0, 10)}…</code>
          {client ? <> at <b>{client.name}</b></> : null}.{" "}
          <form action={signOutPaxelDevAction} className="inline-form">
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
              <a href={publicUrl}>{publicUrl}</a> — anyone with this link can view the dimensions you
              ticked. No tokens, cost, projects or messages are shown there.
            </p>
            <p className="muted small">
              To stop sharing, untick every dimension and save, or press "Turn off public profile".
            </p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><h2>Regenerating this browser's claim</h2></div>
        <div className="panel-body">
          <p className="muted small">
            This browser is bound to your laptop via a signed cookie. If you lose the laptop or want
            to move to a new browser, run <code>zinloop paxel</code> again on the laptop you want to
            keep — the output always includes a fresh{" "}
            <code>https://zinloop.com/paxel/claim?token=…</code> URL. Open it in the browser you want
            to bind. The token file on the laptop stays the same unless you delete{" "}
            <code>~/.zinloop/paxel-claim-token</code>; deleting it makes the next run issue a new
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
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Public profile {isOn ? <span className="pill on">On</span> : <span className="pill off">Off</span>}</h2>
      </div>
      <div className="panel-body">
        <p className="muted small">
          Pick which dimensions to show on your public page. Nothing is published until at least one
          is ticked and you save. Toggle them all off (or press "Turn off public profile") to
          unpublish.
        </p>
        <form action={savePaxelSettingsAction} className="form">
          <label>
            <span>Display name on the public page</span>
            <input name="displayName" defaultValue={initial?.displayName || fallbackName} maxLength={120} />
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
      </div>
    </section>
  );
}

function NotClaimed() {
  return (
    <div className="wrap narrow">
      <h1>Paxel settings</h1>
      <p className="muted">
        This browser isn't signed in to any Paxel developer identity yet. Run{" "}
        <code>zinloop paxel</code> on your laptop once — the end of the output prints a URL in the
        shape <code>https://zinloop.com/paxel/claim?token=…</code>. Open that URL in this browser,
        then come back here.
      </p>
      <p className="muted small">
        You never need an MSP or portal login to manage your own Paxel profile. The signed cookie
        this flow sets is scoped to <code>paxel_dev</code> only.
      </p>
    </div>
  );
}
