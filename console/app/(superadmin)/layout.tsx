import "./superadmin.css";
import { currentSuperadmin } from "@/lib/superadmin.ts";
import { superadminLogoutAction } from "./superadmin/login/actions.ts";

export const dynamic = "force-dynamic";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentSuperadmin();
  return (
    <div className="sa">
      <header className="sa-top">
        <span className="sa-brand">Zinloop · <b>Super admin</b></span>
        {admin && (
          <form action={superadminLogoutAction} className="sa-top-right">
            <span>{admin.email}</span>
            <button type="submit" className="sa-link">Sign out</button>
          </form>
        )}
      </header>
      <main className="sa-main">{children}</main>
    </div>
  );
}
