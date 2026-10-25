import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClient, loadClientChanges } from "@/lib/data.ts";

export const dynamic = "force-dynamic";

function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function label(r: {
  added: number;
  removed: number;
  changed: number;
  riskUp: number;
  riskDown: number;
  returned: number;
}): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} new`);
  if (r.changed) {
    const detail = r.riskUp && r.riskDown
      ? `${r.changed} changed (${r.riskUp} ↑, ${r.riskDown} ↓)`
      : r.riskUp
        ? `${r.changed} changed (${r.riskUp} ↑)`
        : r.riskDown
          ? `${r.changed} changed (${r.riskDown} ↓)`
          : `${r.changed} changed`;
    parts.push(detail);
  }
  if (r.removed) parts.push(`${r.removed} removed`);
  if (r.returned) parts.push(`${r.returned} came back`);
  return parts.length === 0 ? "no changes" : parts.join(" · ");
}

export default async function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadClient(id);
  if (!detail) notFound();
  const changes = detail.demo ? [] : await loadClientChanges(id, 200);
  return (
    <>
      <p className="small">
        <Link href={`/app/clients/${detail.client.id}`}>← Back to {detail.client.name}</Link>
      </p>
      <h1>What's changed on {detail.client.name}</h1>
      <p className="small">
        Each row is one scan compared to the one before it. New AI tools, changed permissions, and risky
        configs that came back after remediation are called out.
      </p>
      {detail.demo && (
        <div className="card" style={{ marginTop: 16 }}>
          <p>Change history is live-data only; the demo mode doesn't have any yet.</p>
        </div>
      )}
      {!detail.demo && changes.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p>No scans compared yet. Once a laptop uploads two scans, the delta will show here.</p>
        </div>
      )}
      {!detail.demo && changes.length > 0 && (
        <table className="table" style={{ marginTop: 16, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>When</th>
              <th style={{ textAlign: "left" }}>Laptop</th>
              <th style={{ textAlign: "left" }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id}>
                <td>
                  <span title={c.at}>{ago(c.at)}</span>
                </td>
                <td>{c.deviceHostname}</td>
                <td>{label(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
