import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { checkInvite } from "@/lib/accounts.ts";
import { hasDatabase } from "@/lib/db.ts";
import { JoinForm } from "./JoinForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join your team", referrer: "no-referrer" };

export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  if (!hasDatabase()) redirect("/app");
  const { token } = await params;
  const invite = await checkInvite(token);
  return (
    <div className="wrap auth">
      <section className="card strong">
        {invite ? (
          <>
            <h1 className="disp h2">Join {invite.mspName}</h1>
            <p className="body">You've been invited to the {invite.mspName} console on Zinloop Security.</p>
            <JoinForm token={token} email={invite.email} />
          </>
        ) : (
          <>
            <h1 className="disp h2">This invite has expired</h1>
            <p className="body">Invite links work once and last 7 days. Ask your teammate to send a new one, or <Link href="/login">sign in</Link>.</p>
          </>
        )}
      </section>
    </div>
  );
}
