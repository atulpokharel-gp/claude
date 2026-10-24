import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { hasAppSecret, verifySigned } from "@/lib/crypto.ts";
import { currentSession } from "@/lib/session.ts";
import { cancelMfaAction } from "./actions.ts";
import { MFA_COOKIE } from "@/lib/session.ts";
import { LoginForm, MfaForm } from "./LoginForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!hasDatabase()) redirect("/app"); // demo mode has no accounts
  if (await currentSession()) redirect("/app");
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
            <LoginForm />
            <p className="small">New to Zinloop? <Link href="/free-scan">Create a free account</Link></p>
          </>
        )}
      </section>
    </div>
  );
}
