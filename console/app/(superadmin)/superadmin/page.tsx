import type { Metadata } from "next";
import { listCompanies, listPlatformUsers, platformStats, registrationTrend, requireSuperadmin } from "@/lib/superadmin.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Super admin" };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

export default async function SuperadminDashboard() {
  await requireSuperadmin();
  const [stats, companies, users, trend] = await Promise.all([
    platformStats(),
    listCompanies(),
    listPlatformUsers(),
    registrationTrend(30),
  ]);
  const maxReg = Math.max(1, ...trend.map((p) => p.users + p.companies));

  return (
    <>
      <h1>Platform overview</h1>
      <p className="sub">Every company and user across Zinloop. Read-only.</p>

      <div className="sa-tiles">
        <div className="sa-tile"><b>{stats.companies}</b><span>Companies</span><div className="delta">+{stats.new_companies_30d} in 30d</div></div>
        <div className="sa-tile"><b>{stats.users}</b><span>Users</span><div className="delta">+{stats.signups_30d} in 30d</div></div>
        <div className="sa-tile"><b>{stats.devices}</b><span>Devices scanned</span></div>
        <div className="sa-tile"><b>{stats.scans}</b><span>Scans ingested</span></div>
      </div>

      <h2>Registrations · last 30 days</h2>
      <div className="sa-bars" aria-label="Daily sign-ups, last 30 days">
        {trend.map((p) => (
          <div
            key={p.day}
            className="bar"
            style={{ height: `${Math.round(((p.users + p.companies) / maxReg) * 100)}%` }}
            title={`${p.day}: ${p.users} users, ${p.companies} companies`}
          />
        ))}
      </div>

      <h2>Companies ({companies.length})</h2>
      <div className="sa-card">
        <table>
          <thead>
            <tr><th>Company</th><th>Plan</th><th className="num">Users</th><th className="num">Devices</th><th>Last scan</th><th>Created</th></tr>
          </thead>
          <tbody>
            {companies.length === 0 && <tr><td colSpan={6} className="muted">No companies yet.</td></tr>}
            {companies.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className="pill">{c.plan}</span></td>
                <td className="num">{c.users}</td>
                <td className="num">{c.devices}</td>
                <td className="muted">{fmtDate(c.last_scan_at)}</td>
                <td className="muted">{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Users ({users.length})</h2>
      <div className="sa-card">
        <table>
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>Company</th><th>Registered</th></tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={5} className="muted">No users yet.</td></tr>}
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td className="muted">{u.name || "—"}</td>
                <td><span className={`pill ${u.role === "owner" ? "owner" : ""}`}>{u.role}</span></td>
                <td>{u.company}</td>
                <td className="muted">{fmtDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
