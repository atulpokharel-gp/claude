// Views across all of an MSP's clients: the people using AI tools, the tools
// themselves, and what needs attention this week. Pure functions over Client[].

import { agentRisk, worst } from "./risk.ts";
import type { Agent, Client, Severity } from "./types.ts";

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, none: 0 };
const worse = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

export interface PersonTool {
  name: string;
  app: string;
  source: Agent["source"];
  risk: Severity;
  agentId: string;
}

export interface Person {
  /** Unique across the MSP: client id + person key. */
  id: string;
  name: string;
  email?: string;
  clientId: string;
  clientName: string;
  /** Laptops their configs were found on. */
  devices: string[];
  tools: PersonTool[];
  risk: Severity;
  /** Open findings across their tools. */
  findings: number;
  lastSeen: string;
}

/** Everyone linked to an AI tool, one row per person per client. */
export function peopleFrom(clients: Client[]): Person[] {
  const out = new Map<string, Person>();
  for (const c of clients) {
    for (const a of c.agents) {
      for (const p of a.people ?? []) {
        const id = `${c.id}:${p.key}`;
        let person = out.get(id);
        if (!person) {
          person = { id, name: p.name, clientId: c.id, clientName: c.name, devices: [], tools: [], risk: "none", findings: 0, lastSeen: "" };
          out.set(id, person);
        }
        // A Microsoft 365 display name reads better than a laptop profile name.
        if (p.email) {
          person.name = p.name;
          person.email = p.email;
        }
        if (a.source === "Laptop scan") {
          const device = a.location.split(" · ")[0];
          if (!person.devices.includes(device)) person.devices.push(device);
        }
        const risk = agentRisk(a);
        person.tools.push({ name: a.name, app: a.app, source: a.source, risk, agentId: a.id });
        person.risk = worse(person.risk, risk);
        person.findings += a.findings.filter((f) => f.severity !== "none").length;
        if (a.lastSeen > person.lastSeen) person.lastSeen = a.lastSeen;
      }
    }
  }
  return [...out.values()].sort((x, y) => RANK[y.risk] - RANK[x.risk] || y.findings - x.findings || x.name.localeCompare(y.name));
}

export interface ToolSummary {
  /** Lowercased name, used in links. */
  key: string;
  name: string;
  kind: Agent["kind"];
  apps: string[];
  clients: { id: string; name: string }[];
  people: number;
  /** How many installs or grants were found. */
  count: number;
  risk: Severity;
  /** Most common finding, to show what's wrong at a glance. */
  topFinding?: string;
  /** Approved for everyone at one or more clients. */
  orgWide: boolean;
}

/** Each AI tool or MCP server once, with where it's used. */
export function toolsFrom(clients: Client[]): ToolSummary[] {
  const out = new Map<string, ToolSummary & { findingCounts: Map<string, number>; peopleIds: Set<string> }>();
  for (const c of clients) {
    for (const a of c.agents) {
      const key = toolKey(a.name);
      let t = out.get(key);
      if (!t) {
        t = { key, name: a.name, kind: a.kind, apps: [], clients: [], people: 0, count: 0, risk: "none", orgWide: false, findingCounts: new Map(), peopleIds: new Set() };
        out.set(key, t);
      }
      t.count++;
      if (!t.apps.includes(a.app)) t.apps.push(a.app);
      if (!t.clients.some((x) => x.id === c.id)) t.clients.push({ id: c.id, name: c.name });
      for (const p of a.people ?? []) t.peopleIds.add(`${c.id}:${p.key}`);
      t.risk = worse(t.risk, worst(a.findings));
      if (a.findings.some((f) => f.ruleId === "M365_ORG_WIDE_GRANT")) t.orgWide = true;
      for (const f of a.findings) if (f.severity !== "none") t.findingCounts.set(f.title, (t.findingCounts.get(f.title) ?? 0) + 1);
    }
  }
  return [...out.values()]
    .map(({ findingCounts, peopleIds, ...t }) => ({
      ...t,
      people: peopleIds.size,
      topFinding: [...findingCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0],
    }))
    .sort((x, y) => RANK[y.risk] - RANK[x.risk] || y.clients.length - x.clients.length || y.count - x.count || x.name.localeCompare(y.name));
}

export function toolKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface AttentionItem {
  kind: "high" | "stale" | "coverage" | "incomplete";
  clientId: string;
  clientName: string;
  text: string;
}

/** Short list of what an MSP should look at first. */
export function attention(clients: Client[], now: Date, staleDays = 7): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const c of clients) {
    const high = c.agents.filter((a) => agentRisk(a) === "high");
    if (high.length > 0) {
      const names = [...new Set(high.map((a) => a.name))];
      items.push({
        kind: "high",
        clientId: c.id,
        clientName: c.name,
        text: `${high.length} high-risk ${high.length === 1 ? "tool" : "tools"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`,
      });
    }
    const last = new Date(c.lastScan).getTime();
    if (c.devices > 0 && (last <= 0 || now.getTime() - last > staleDays * 86_400_000)) {
      items.push({ kind: "stale", clientId: c.id, clientName: c.name, text: last <= 0 ? "No laptop has reported yet" : `No laptop has reported in ${Math.floor((now.getTime() - last) / 86_400_000)} days` });
    } else if (c.devices > 0 && c.devicesScanned / c.devices < 0.8) {
      items.push({ kind: "coverage", clientId: c.id, clientName: c.name, text: `Only ${c.devicesScanned.toLocaleString("en-US")} of ${c.devices.toLocaleString("en-US")} laptops scanned this week` });
    }
    if ((c.warnings ?? []).length > 0) {
      items.push({ kind: "incomplete", clientId: c.id, clientName: c.name, text: `${c.warnings!.length} ${c.warnings!.length === 1 ? "scan" : "scans"} couldn't be read completely` });
    }
  }
  const order = { high: 0, stale: 1, incomplete: 2, coverage: 3 };
  return items.sort((x, y) => order[x.kind] - order[y.kind]);
}

/** Today's risk counts for one client, as saved for the trend chart. */
export function snapshotOf(c: Client): { high: number; medium: number; low: number; tools: number; people: number } {
  let high = 0;
  let medium = 0;
  let low = 0;
  const people = new Set<string>();
  for (const a of c.agents) {
    const r = agentRisk(a);
    if (r === "high") high++;
    else if (r === "medium") medium++;
    else if (r === "low") low++;
    for (const p of a.people ?? []) people.add(p.key);
  }
  return { high, medium, low, tools: c.agents.length, people: people.size };
}
