// The client-facing report: what was found, grouped into plain-language
// actions, plus coverage. Pure so it can be tested and printed.

import { agentRisk, countRisk, keyCounts } from "./risk.ts";
import type { Client, Severity } from "./types.ts";

export interface ReportAction {
  ruleId: string;
  severity: Severity;
  title: string;
  fix: string;
  /** How many AI tools have this problem. */
  tools: number;
  /** Where: device names or Microsoft 365 apps, without duplicates. */
  places: string[];
}

export interface ClientReport {
  clientName: string;
  preparedBy: string;
  date: string;
  headline: string;
  tools: number;
  high: number;
  medium: number;
  plainKeys: number;
  keysProtected: number;
  laptopsReporting: number;
  laptopsExpected: number;
  m365Apps: number;
  actions: ReportAction[];
  clean: string[];
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, none: 3 };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildReport(client: Client, preparedBy: string, now = new Date()): ClientReport {
  const counts = countRisk(client.agents);
  const keys = keyCounts(client.agents);
  const byRule = new Map<string, ReportAction>();
  for (const a of client.agents) {
    for (const f of a.findings) {
      let act = byRule.get(f.ruleId);
      if (!act) {
        act = { ruleId: f.ruleId, severity: f.severity, title: f.title, fix: f.fix, tools: 0, places: [] };
        byRule.set(f.ruleId, act);
      }
      act.tools++;
      const place = a.source === "Microsoft 365" ? `Microsoft 365 · ${a.name}` : a.location.split(" · ")[0];
      if (!act.places.includes(place)) act.places.push(place);
    }
  }
  const actions = [...byRule.values()].sort((x, y) => ORDER[x.severity] - ORDER[y.severity] || y.tools - x.tools);
  const clean = client.agents.filter((a) => agentRisk(a) === "none").map((a) => `${a.name} (${a.app})`);
  const m365Apps = client.agents.filter((a) => a.source === "Microsoft 365").length;
  const protectedKeys = client.agents.reduce((n, a) => n + (a.protectedKeys?.length ?? 0), 0);

  let headline: string;
  if (client.agents.length === 0) {
    headline =
      client.devicesScanned === 0
        ? "No laptops have reported yet, so there is nothing to show."
        : "No AI tools with company access were found on the laptops that reported.";
  } else if (counts.high > 0) {
    headline = `We found ${plural(client.agents.length, "AI tool")} connected to company systems. ${plural(counts.high, "needs", "need")} action now.`;
  } else {
    headline = `We found ${plural(client.agents.length, "AI tool")} connected to company systems. None is high risk.`;
  }

  return {
    clientName: client.name,
    preparedBy,
    date: now.toISOString().slice(0, 10),
    headline,
    tools: client.agents.length,
    high: counts.high,
    medium: counts.medium,
    plainKeys: keys.plain,
    keysProtected: protectedKeys,
    laptopsReporting: client.devicesScanned,
    laptopsExpected: client.devices,
    m365Apps,
    actions,
    clean,
  };
}
