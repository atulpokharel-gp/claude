import type { Metadata } from "next";
import Link from "next/link";
import { loadOverview } from "@/lib/data.ts";
import { peopleFrom, toolKey } from "@/lib/insights.ts";
import { RiskPill } from "@/components/RiskPill.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People" };

type Search = { q?: string; client?: string; tool?: string; risk?: string };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 100);
  const tool = (sp.tool ?? "").trim().toLowerCase().slice(0, 200);
  const risk = sp.risk === "high" || sp.risk === "action" ? sp.risk : "";
  const { clients } = await loadOverview();
  const everyone = peopleFrom(clients);
  const people = everyone.filter(
    (p) =>
      (!sp.client || p.clientId === sp.client) &&
      (!tool || p.tools.some((t) => toolKey(t.name) === tool)) &&
      (!risk || p.risk === "high" || (risk === "action" && p.risk === "medium")) &&
      (!q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q) || p.tools.some((t) => t.name.toLowerCase().includes(q))),
  );
  const toolName = tool ? everyone.flatMap((p) => p.tools).find((t) => toolKey(t.name) === tool)?.name ?? sp.tool : "";
  const filtered = Boolean(q || sp.client || tool || risk);

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
        <p className="muted">
          Everyone at your clients who uses an AI tool on a laptop or gave one access in Microsoft 365 · {everyone.length} people across {clients.length} clients
        </p>
      </div>

      <form className="filter-bar" role="search" method="get">
        <label className="sr-only" htmlFor="q">Search people</label>
        <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Search by name, email, client or tool" />
        <label className="sr-only" htmlFor="client">Client</label>
        <select id="client" name="client" defaultValue={sp.client ?? ""}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="risk">Risk</label>
        <select id="risk" name="risk" defaultValue={risk}>
          <option value="">Any risk</option>
          <option value="high">High risk only</option>
          <option value="action">Needs action (high or medium)</option>
        </select>
        {tool && <input type="hidden" name="tool" value={tool} />}
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href="/app/people" className="small">Clear</Link>}
      </form>
      {toolName && <p className="small">Showing people using <b>{toolName}</b>. <Link href="/app/people">Show everyone</Link></p>}

      <section className="panel">
        {people.length === 0 ? (
          <p className="empty">
            {everyone.length === 0
              ? "No people yet. They appear when laptops report with the latest scanner (it tags each tool with its user) or when Microsoft 365 is connected."
              : "Nobody matches these filters."}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Client</th>
                  <th>AI tools</th>
                  <th>Laptops</th>
                  <th>Risk</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {people.slice(0, 500).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      {p.email && <div className="muted small">{p.email}</div>}
                    </td>
                    <td><Link href={`/app/clients/${p.clientId}`}>{p.clientName}</Link></td>
                    <td>
                      <div className="chips">
                        {p.tools.map((t, i) => (
                          <Link key={`${t.agentId}-${i}`} href={`/app/people?tool=${encodeURIComponent(toolKey(t.name))}`} className={`chip-link ${t.risk}`} title={`${t.app} · ${t.source}`}>
                            {t.name}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="small">{p.devices.join(", ") || <span className="muted">Microsoft 365 only</span>}</td>
                    <td>{p.findings > 0 ? <RiskPill risk={p.risk} /> : <RiskPill risk="none" />}</td>
                    <td className="muted small">{p.lastSeen || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {people.length > 500 && <p className="muted small" style={{ padding: "8px 16px" }}>Showing the first 500 of {people.length}. Narrow the search to see the rest.</p>}
      </section>
    </>
  );
}
