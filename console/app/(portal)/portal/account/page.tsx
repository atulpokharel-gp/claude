import type { Metadata } from "next";
import { getEmailPrefs } from "@/lib/accounts.ts";
import { listSessions } from "@/lib/auth.ts";
import { requireViewer } from "@/lib/session.ts";
import { ChangePassword, EmailPrefsForm, TwoFactor } from "@/app/(console)/app/settings/SettingsForms.tsx";
import { SessionsPanel } from "@/components/SessionsPanel.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

export default async function PortalAccount() {
  const s = await requireViewer({ mfaSetup: true });
  const [sessions, prefs] = await Promise.all([listSessions(s), getEmailPrefs(s.mspId, s.userId)]);
  return (
    <>
      <div className="page-head">
        <h1>Your account</h1>
        <p className="muted">{s.email} · read-only access to {s.clientName}, given by {s.mspName}</p>
      </div>
      {s.requireMfa && !s.mfa && (
        <section className="warning" role="alert">
          <h2>Set up two-factor sign-in to continue</h2>
          <p>{s.mspName} requires it for everyone. Set it up below; then your company&apos;s results open.</p>
        </section>
      )}
      <section className="panel">
        <div className="panel-head"><h2>Two-factor sign-in</h2></div>
        <div className="panel-body"><TwoFactor enabled={s.mfa} /></div>
      </section>
      <SessionsPanel sessions={sessions} />
      <section className="panel">
        <div className="panel-head"><h2>Email</h2></div>
        <div className="panel-body"><EmailPrefsForm alerts={false} weekly={prefs.weekly} viewer /></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Password</h2></div>
        <div className="panel-body"><ChangePassword /></div>
      </section>
    </>
  );
}
