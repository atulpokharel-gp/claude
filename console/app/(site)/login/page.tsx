import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { currentSession } from "@/lib/session.ts";
import { LoginForm } from "./LoginForm.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!hasDatabase()) redirect("/"); // demo mode has no accounts
  if (await currentSession()) redirect("/");
  return (
    <section className="panel narrow">
      <h1>Sign in</h1>
      <p className="muted">Sign in to see your clients' AI agents.</p>
      <LoginForm />
    </section>
  );
}
