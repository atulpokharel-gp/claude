import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AUDIT_ACTIONS, listAudit } from "@/lib/audit.ts";
import { hasDatabase } from "@/lib/db.ts";
import { requireOwner } from "@/lib/session.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string }> }) {
  if (!hasDatabase()) redirect("/app");
  const s = await requireOwner();
  const sp = await searchParams;
  const entries = await listAudit(s.mspId, { action: sp.action, before: sp.before, limit: PAGE + 1 });
  const more = entries.length > PAGE;
  const shown = entries.slice(0, PAGE);
  const qs = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ action: sp.action, ...extra })) if (v) q.set(k, v);
    const str = q.toString();
    return str ? `?${str}` : "";
  };

  return (
    <>
      <div className="page-head">
        <h1>Audit log</h1>
        <p className="muted">Every sign-in, change and revoke in {s.mspName}, newest first. Entries can&apos;t be edited or deleted.</p>
        <a className="btn" href={`/app/settings/audit/export${qs({})}`}>Download CSV</a>
      </div>

      <form className="filter-bar" method="get">
        <label className="sr-only" htmlFor="action">What</label>
        <select id="action" name="action" defaultValue={sp.action ?? ""}>
          <option value="">Everything</option>
          {Object.entries(AUDIT_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
        <Link href="/app/settings" className="small">Back to settings</Link>
      </form>

      <section className="panel">
        {shown.length === 0 ? (
          <p className="empty">Nothing recorded{sp.action ? " for this filter" : ""} yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Details</th><th>IP address</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="small">{e.at.slice(0, 16).replace("T", " ")}</td>
                    <td className="small">{e.actorEmail || <span className="muted">System</span>}</td>
                    <td className={e.action === "sign_in_failed" ? "bad" : undefined}>{e.label}</td>
                    <td className="small">
                      {e.target}
                      {typeof e.detail.reason === "string" && <span className="muted"> ({e.detail.reason})</span>}
                      {typeof e.detail.required === "boolean" && <span>{e.detail.required ? "Required" : "Optional"}</span>}
                      {typeof e.detail.count === "number" && <span>{e.detail.count} {e.detail.count === 1 ? "device" : "devices"}</span>}
                    </td>
                    <td className="small">{e.ip || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {more && (
        <p><Link href={`/app/settings/audit${qs({ before: shown[shown.length - 1].id })}`}>Older entries →</Link></p>
      )}
    </>
  );
}
