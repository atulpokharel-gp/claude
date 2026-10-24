import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTeam, PLAN_LIMITS } from "@/lib/accounts.ts";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { revokeInviteAction } from "./actions.ts";
import { ChangePassword, InviteForm, RemoveMember, TwoFactor } from "./SettingsForms.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

const PLAN_NAMES = { free: "Free", partner: "Design partner", msp: "MSP" } as const;

export default async function Settings() {
  if (!hasDatabase()) redirect("/app");
  const s = await requireSession();
  const team = await getTeam(s.mspId);
  const me = team.members.find((m) => m.id === s.userId);
  const limits = PLAN_LIMITS[team.plan];
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">{s.mspName}</p>
      </div>

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
                  <td>{m.role !== "owner" && m.id !== s.userId && <RemoveMember id={m.id} name={m.name || m.email} />}</td>
                </tr>
              ))}
              {team.invites.map((i) => (
                <tr key={i.id}>
                  <td className="muted">Invited</td>
                  <td>{i.email}</td>
                  <td>Member</td>
                  <td className="muted">Expires {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="btn small" type="submit">Cancel invite</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body"><InviteForm /></div>
      </section>
    </>
  );
}
