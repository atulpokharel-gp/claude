import type { Metadata } from "next";
import Link from "next/link";
import { loadOverview } from "@/lib/data.ts";
import { toolsFrom } from "@/lib/insights.ts";
import { RiskPill } from "@/components/RiskPill.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI tools" };

const KIND: Record<string, string> = { "mcp-server": "MCP server", "copilot-agent": "Copilot agent", "oauth-app": "Microsoft 365 app" };

export default async function ToolsPage() {
  const { clients } = await loadOverview();
  const tools = toolsFrom(clients);
  const shared = tools.filter((t) => t.affectedClients > 1);

  return (
    <>
      <div className="page-head">
        <h1>AI tools</h1>
        <p className="muted">Every AI tool and MCP server found, once, with where it&apos;s used · {tools.length} tools across {clients.length} clients</p>
      </div>

      {shared.length > 0 && (
        <section className="callout">
          <b>Fix once, help many clients:</b>{" "}
          {shared.slice(0, 4).map((t, i) => (
            <span key={t.key}>
              {i > 0 && ", "}
              {t.name} ({t.affectedClients} clients)
            </span>
          ))}
          {shared.length > 4 && ` and ${shared.length - 4} more`} have problems at more than one client.
        </section>
      )}

      <section className="panel">
        {tools.length === 0 ? (
          <p className="empty">No AI tools found yet. They appear when laptops report or Microsoft 365 is connected.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Worst risk</th>
                  <th>Main problem</th>
                  <th>Clients</th>
                  <th>People</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <b>{t.name}</b>
                      <div className="muted small">{KIND[t.kind]} · {t.apps.slice(0, 3).join(", ")}{t.apps.length > 3 ? "…" : ""}</div>
                    </td>
                    <td><RiskPill risk={t.risk} /></td>
                    <td className="small">{t.topFinding ?? <span className="muted">None</span>}{t.orgWide && <div className="muted">Approved for everyone at a client</div>}</td>
                    <td className="small">
                      {t.clients.slice(0, 3).map((c, i) => (
                        <span key={c.id}>{i > 0 && ", "}<Link href={`/app/clients/${c.id}`}>{c.name}</Link></span>
                      ))}
                      {t.clients.length > 3 && ` +${t.clients.length - 3}`}
                    </td>
                    <td className="num">{t.people > 0 ? <Link href={`/app/people?tool=${encodeURIComponent(t.key)}`}>{t.people}</Link> : t.orgWide ? "Everyone" : "—"}</td>
                    <td className="num">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
