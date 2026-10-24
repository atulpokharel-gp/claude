"use client";

import { useMemo, useState } from "react";
import type { Agent, Client, Severity } from "@/lib/types.ts";
import { agentRisk, countRisk, sortAgents } from "@/lib/risk.ts";
import { RiskPill } from "./RiskPill.tsx";

type Filter = "all" | "action" | "m365" | "laptop";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Needs action" },
  { key: "m365", label: "Microsoft 365" },
  { key: "laptop", label: "Laptops" },
];

const KIND_LABEL: Record<Agent["kind"], string> = {
  "mcp-server": "MCP server",
  "copilot-agent": "Copilot agent",
  "oauth-app": "AI app with access",
};

function matches(a: Agent, f: Filter): boolean {
  const r = agentRisk(a);
  if (f === "action") return r === "high" || r === "medium";
  if (f === "m365") return a.source === "Microsoft 365";
  if (f === "laptop") return a.source === "Laptop scan";
  return true;
}

export function ClientView({ client }: { client: Client }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = sortAgents(client.agents)[0];
    return new Set(first ? [first.id] : []);
  });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const active = useMemo(() => client.agents.filter((a) => !revoked.has(a.id)), [client.agents, revoked]);
  const counts = countRisk(active);
  const shown = sortAgents(client.agents).filter((a) => matches(a, filter));

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function revoke(a: Agent) {
    setRevoked((prev) => new Set(prev).add(a.id));
    setConfirming(null);
    flash(`Revoked access for ${a.name} (demo, nothing was changed)`);
  }

  async function copyFix(a: Agent) {
    const text = [`${a.name} on ${a.location} (${a.app})`, ...a.findings.map((f, i) => `${i + 1}. ${f.title}\n   Fix: ${f.fix}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      flash("Fix steps copied. Paste them into a ticket.");
    } catch {
      flash("Couldn't copy. Select the text and copy it by hand.");
    }
  }

  const coverage = client.devices > 0 ? Math.round((client.devicesScanned / client.devices) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <h1>{client.name}</h1>
        <p className="muted">
          {client.industry} · {client.staff.toLocaleString("en-US")} staff · last scan{" "}
          {new Date(client.lastScan).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
        </p>
      </div>

      {client.warnings && client.warnings.length > 0 && (
        <section className="warning" role="alert">
          <h2>This scan is incomplete</h2>
          <p>Some config files couldn&apos;t be read, so agents in them are missing below. Fix the files or check permissions, then scan again.</p>
          <ul>{client.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      <section className="tiles" aria-label="Summary">
        <div className="tile"><b>{counts.total}</b><span>agents and MCP servers with access</span></div>
        <div className="tile high"><b>{counts.high}</b><span>high-risk</span></div>
        <div className="tile"><b>{counts.medium}</b><span>medium-risk</span></div>
        <div className="tile"><b>{coverage}%</b><span>of {client.devices.toLocaleString("en-US")} devices scanned</span></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What we found</h2>
          <div className="filters" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="empty">Nothing matches this filter.</p>
        ) : (
          <div className="agents">
            {shown.map((a) => {
              const isOpen = open.has(a.id);
              const isRevoked = revoked.has(a.id);
              const risk: Severity = agentRisk(a);
              return (
                <div key={a.id} className="agent" data-open={isOpen}>
                  <button type="button" className="agent-row" aria-expanded={isOpen} onClick={() => toggle(a.id)}>
                    <span>{isRevoked ? <span className="pill revoked">Revoked</span> : <RiskPill risk={risk} />}</span>
                    <span>
                      <span className="agent-name">{a.name}</span>
                      <span className="agent-sub"> · {KIND_LABEL[a.kind]}</span>
                      <span className="agent-sub" style={{ display: "block" }}>{a.app}</span>
                    </span>
                    <span className="agent-sub hide-sm">{a.source === "Laptop scan" ? `Laptop ${a.location}` : a.location}</span>
                    <span className="agent-sub hide-sm">{a.findings.length === 0 ? "No problems found" : `${a.findings.length} finding${a.findings.length > 1 ? "s" : ""}`}</span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>

                  {isOpen && (
                    <div className="agent-body">
                      <div>
                        <div className="muted small">Can reach</div>
                        <div className="reach">{a.reach.map((r) => <span key={r}>{r}</span>)}</div>
                      </div>

                      {a.findings.map((f) => (
                        <div key={f.ruleId} className={`finding ${f.severity}`}>
                          <h3>{f.title}</h3>
                          <p>{f.detail}</p>
                          <p className="fix"><b>Fix:</b> {f.fix}</p>
                          <span className="rule">{f.ruleId}</span>
                        </div>
                      ))}

                      <div className="actions">
                        {a.revocable && !isRevoked && confirming !== a.id && risk !== "none" && (
                          <button type="button" className="btn danger" onClick={() => setConfirming(a.id)}>Revoke access</button>
                        )}
                        {confirming === a.id && (
                          <>
                            <span className="small">Remove {a.name}&apos;s access in Microsoft 365 for everyone at {client.name}?</span>
                            <button type="button" className="btn danger" onClick={() => revoke(a)}>Yes, revoke</button>
                            <button type="button" className="btn" onClick={() => setConfirming(null)}>Cancel</button>
                          </>
                        )}
                        {isRevoked && <span className="small muted">Access revoked. You can add it back from Microsoft Entra if someone still needs it.</span>}
                        {!a.revocable && a.findings.length > 0 && (
                          <button type="button" className="btn" onClick={() => copyFix(a)}>Copy fix steps</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
