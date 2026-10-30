import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { checkResetToken } from "@/lib/accounts.ts";
import { hasDatabase } from "@/lib/db.ts";
import { ResetForm } from "./ResetForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set a new password", referrer: "no-referrer" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  if (!hasDatabase()) redirect("/app");
  const { token } = await params;
  const reset = await checkResetToken(token);
  return (
    <div className="wrap auth">
      <section className="card strong">
        {reset ? (
          <>
            <h1 className="disp h2">Set a new password</h1>
            <p className="body">Choose a new password for <b>{reset.email}</b>.</p>
            <ResetForm token={token} email={reset.email} />
          </>
        ) : (
          <>
            <h1 className="disp h2">This reset link has expired</h1>
            <p className="body">Reset links work once and last an hour. <Link href="/forgot">Ask for a new one</Link>, or <Link href="/login">sign in</Link>.</p>
          </>
        )}
      </section>
    </div>
  );
}
