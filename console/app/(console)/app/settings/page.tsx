import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEmailPrefs, getTeam, PLAN_LIMITS } from "@/lib/accounts.ts";
import { listSessions } from "@/lib/auth.ts";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { revokeInviteAction } from "./actions.ts";
import { ChangePassword, EmailPrefsForm, InviteForm, RemoveMember, RequireMfa, TwoFactor } from "./SettingsForms.tsx";
import { SessionsPanel } from "@/components/SessionsPanel.tsx";
import { MicrosoftLinkPanel } from "@/components/MicrosoftLinkPanel.tsx";
import { GoogleLinkPanel } from "@/components/GoogleLinkPanel.tsx";
import { getGoogleLink, getMicrosoftLink } from "@/lib/identities.ts";
import { hasSso } from "@/lib/microsoft-sso.ts";
import { hasGoogleSso } from "@/lib/google-sso.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

const PLAN_NAMES = { free: "Free", partner: "Design partner", msp: "MSP" } as const;

export default async function Settings({ searchParams }: { searchParams: Promise<{ mfa?: string; owner?: string; sso?: string }> }) {
  if (!hasDatabase()) redirect("/app");
  const s = await requireSession({ mfaSetup: true });
  const sp = await searchParams;
  const [team, sessions, prefs, msLink, gLink] = await Promise.all([getTeam(s.mspId), listSessions(s), getEmailPrefs(s.mspId, s.userId), getMicrosoftLink(s), getGoogleLink(s)]);
  const isOwner = s.role === "owner";
  const me = team.members.find((m) => m.id === s.userId);
  const limits = PLAN_LIMITS[team.plan];
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">{s.mspName}</p>
        {isOwner && <Link className="btn" href="/app/settings/audit">Audit log</Link>}
      </div>

      {s.requireMfa && !s.mfa && (
        <section className="warning" role="alert">
          <h2>Set up two-factor sign-in to continue</h2>
          <p>{s.mspName} requires it for everyone. Set it up below; then the rest of the console opens.</p>
        </section>
      )}
      {sp.owner === "required" && (
        <section className="warning" role="alert"><p>Only the account owner can do that.</p></section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Plan</h2></div>
        <div className="panel-body">
          <p>
            <b>{PLAN_NAMES[team.plan]}</b>
            {Number.isFinite(limits.clients)
              ? ` · up to ${limits.clients} client and ${limits.devices} laptops. Email hello@zinloop.com to upgrade.`
              : " · no client or laptop limits."}
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Two-factor sign-in</h2></div>
        <div className="panel-body"><TwoFactor enabled={Boolean(me?.mfa)} /></div>
      </section>

      {isOwner && (
        <section className="panel">
          <div className="panel-head"><h2>Two-factor sign-in for your team</h2></div>
          <div className="panel-body"><RequireMfa on={team.requireMfa} canTurnOn={Boolean(me?.mfa)} /></div>
        </section>
      )}

      <SessionsPanel sessions={sessions} />
      <MicrosoftLinkPanel link={msLink} available={hasSso()} notice={sp.sso} />
      <GoogleLinkPanel link={gLink} available={hasGoogleSso()} notice={sp.sso} />

      <section className="panel">
        <div className="panel-head"><h2>Email</h2></div>
        <div className="panel-body"><EmailPrefsForm alerts={prefs.alerts} weekly={prefs.weekly} /></div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Password</h2></div>
        <div className="panel-body"><ChangePassword /></div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Team</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Two-factor</th><th></th></tr></thead>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name || "—"}{m.id === s.userId && <span className="muted"> (you)</span>}</td>
                  <td>{m.email}</td>
                  <td>{m.role === "owner" ? "Owner" : "Member"}</td>
                  <td>{m.mfa ? <span className="pill none">On</span> : <span className="pill medium">Off</span>}</td>
                  <td>{isOwner && m.role !== "owner" && m.id !== s.userId && <RemoveMember id={m.id} name={m.name || m.email} />}</td>
                </tr>
              ))}
              {team.invites.map((i) => (
                <tr key={i.id}>
                  <td className="muted">Invited</td>
                  <td>{i.email}</td>
                  <td>Member</td>
                  <td className="muted">Expires {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td>
                    {isOwner && <form action={revokeInviteAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="btn small" type="submit">Cancel invite</button>
                    </form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body">{isOwner ? <InviteForm /> : <p className="muted">Only the account owner can invite or remove teammates.</p>}</div>
      </section>
    </>
  );
}
