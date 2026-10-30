import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { ForgotForm } from "./ForgotForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPage() {
  if (!hasDatabase()) redirect("/app"); // demo mode has no accounts
  return (
    <div className="wrap auth">
      <section className="card strong">
        <h1 className="disp h2">Reset your password</h1>
        <p className="body">Enter your work email and we&apos;ll send you a link to set a new password.</p>
        <ForgotForm />
        <p className="small"><Link href="/login">Back to sign in</Link></p>
      </section>
    </div>
  );
}
