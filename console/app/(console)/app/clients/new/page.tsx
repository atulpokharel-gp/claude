import Link from "next/link";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { NewClientForm } from "./NewClientForm.tsx";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  if (!hasDatabase()) redirect("/app");
  await requireSession();
  return (
    <>
      <p className="small"><Link href="/app">← All clients</Link></p>
      <section className="panel narrow">
        <h1>Add a client</h1>
        <p className="muted">After adding it you&apos;ll get an upload token for its laptops.</p>
        <NewClientForm />
      </section>
    </>
  );
}
