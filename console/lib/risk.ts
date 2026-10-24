import type { Agent, Client, Finding, RiskCounts, Severity } from "./types.ts";

const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1, none: 0 };

export function worst(findings: Finding[]): Severity {
  let w: Severity = "none";
  for (const f of findings) if (rank[f.severity] > rank[w]) w = f.severity;
  return w;
}

export function agentRisk(a: Agent): Severity {
  return worst(a.findings);
}

export function countRisk(agents: Agent[]): RiskCounts {
  const c: RiskCounts = { high: 0, medium: 0, low: 0, none: 0, total: agents.length };
  for (const a of agents) c[agentRisk(a)]++;
  return c;
}

/**
 * A 0–100 score for sorting clients: high findings weigh most, and a client
 * with few scanned devices is pushed up because we can't see the whole picture.
 */
export function clientScore(c: Client): number {
  const r = countRisk(c.agents);
  const coverageGap = c.devices > 0 ? 1 - c.devicesScanned / c.devices : 1;
  const raw = r.high * 12 + r.medium * 4 + r.low * 1 + coverageGap * 15;
  return Math.min(100, Math.round(raw));
}

export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) => rank[agentRisk(b)] - rank[agentRisk(a)] || a.name.localeCompare(b.name),
  );
}

export function severityLabel(s: Severity): string {
  return s === "none" ? "Clean" : s[0].toUpperCase() + s.slice(1);
}
