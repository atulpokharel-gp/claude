import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { hasAppSecret, verifySigned } from "@/lib/crypto.ts";
import { currentSession, homeFor } from "@/lib/session.ts";
import { cancelMfaAction } from "./actions.ts";
import { MFA_COOKIE } from "@/lib/session.ts";
import { LoginForm, MfaForm } from "./LoginForm.tsx";
import { hasSso } from "@/lib/microsoft-sso.ts";
import { hasGoogleSso } from "@/lib/google-sso.ts";

const SSO_NOTICE: Record<string, string> = {
  "not-linked": "That account isn't linked to a Zinloop login yet. Sign in with your password, then link it in your settings.",
  failed: "That sign-in didn't work. Try again, or sign in with your password.",
  expired: "That sign-in took too long or was already used. Try again.",
  cancelled: "That sign-in was cancelled.",
  limited: "Too many attempts. Wait 15 minutes and try again.",
  unavailable: "That sign-in option isn't set up on this server.",
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sso?: string; reset?: string }> }) {
  if (!hasDatabase()) redirect("/app"); // demo mode has no accounts
  {
    const s = await currentSession({ viewer: true });
    if (s) redirect(homeFor(s));
  }
  const params = await searchParams;
  const sso = SSO_NOTICE[params.sso ?? ""];
  const resetDone = params.reset === "1";
  const pending = (await cookies()).get(MFA_COOKIE)?.value;
  const waitingForCode = hasAppSecret() && verifySigned("mfa", pending) !== null;
  return (
    <div className="wrap auth">
      <section className="card strong">
        <h1 className="disp h2">{waitingForCode ? "Enter your code" : "Sign in"}</h1>
        {waitingForCode ? (
          <>
            <MfaForm />
            <form action={cancelMfaAction}><button className="link-btn" type="submit">Use a different account</button></form>
          </>
        ) : (
          <>
            {resetDone && <p className="zok" role="status">Your password has been changed. Sign in with your new password.</p>}
            {sso && <p className="zerror" role="alert">{sso}</p>}
            <LoginForm />
            <p className="small"><Link href="/forgot">Forgot your password?</Link></p>
            {hasSso() && hasAppSecret() && (
              <form method="post" action="/api/auth/microsoft/start" className="sso">
                <input type="hidden" name="mode" value="signin" />
                <button type="submit" className="zbtn zbtn-ghost">Sign in with Microsoft</button>
              </form>
            )}
            {hasGoogleSso() && hasAppSecret() && (
              <form method="post" action="/api/auth/google/start" className="sso">
                <input type="hidden" name="mode" value="signin" />
                <button type="submit" className="zbtn zbtn-ghost">Sign in with Google</button>
              </form>
            )}
            <p className="small">New to Zinloop? <Link href="/free-scan">Create a free account</Link></p>
          </>
        )}
      </section>
    </div>
  );
}
