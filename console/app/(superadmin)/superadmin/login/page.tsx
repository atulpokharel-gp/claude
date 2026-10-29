import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasDatabase } from "@/lib/db.ts";
import { currentSuperadmin } from "@/lib/superadmin.ts";
import { SuperadminLoginForm } from "./LoginForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Super admin sign in" };

export default async function SuperadminLoginPage() {
  if (!hasDatabase()) redirect("/app");
  if (await currentSuperadmin()) redirect("/superadmin");
  return (
    <div className="sa-auth">
      <div className="card">
        <h1>Super admin</h1>
        <p className="sub">Platform operations. Not an MSP login.</p>
        <SuperadminLoginForm />
      </div>
    </div>
  );
}
