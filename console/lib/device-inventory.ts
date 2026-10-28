// Tenant-scoped endpoint inventory sourced from existing devices/scans tables.
// The presentation model deliberately excludes command arguments, raw environment
// values, tool descriptions and other arbitrary fields that could contain secrets.
import { hasDatabase, withTenant } from "./db.ts";
import { requireSession } from "./session.ts";
import { clients as demoClients } from "./sample-data.ts";
import { importScan } from "./scan-import.ts";
import type { Agent, Finding, Severity } from "./types.ts";

export interface ScanSupplement {
  servers: { name: string; app: string; configPath: string; scope: string; transport: string; disabled: boolean; risk: Severity; envKeys: string[]; headerKeys: string[]; protectedKeys: string[]; findings: Finding[] }[];
  configs: { app: string; path: string; found: boolean; servers: number; error: string }[];
  skills: { name: string; source: string; risk: Severity; findings: Finding[] }[];
  tools: { name: string; server: string; risk: Severity; findings: Finding[] }[];
  probes: { server: string; count: number; error: string }[];
  pathWarnings: { app: string; reason: string; severity: string; detail: string }[];
}
export interface Endpoint {
  id: string;
  clientId: string;
  clientName: string;
  hostname: string;
  os: string;
  lastScan: string | null;
  scannerVersion: string | null;
  status: "healthy" | "attention" | "stale" | "incomplete" | "never";
  high: number;
  medium: number;
  low: number;
  applications: string[];
  agents: Agent[];
  details: ScanSupplement;
  incomplete: string[];
  demo: boolean;
}
interface DeviceDbRow {
  id: string; client_id: string; client_name: string; hostname: string; os: string;
  last_scan_at: Date | null; report: unknown;
}
const emptyDetails = (): ScanSupplement => ({ servers: [], configs: [], skills: [], tools: [], probes: [], pathWarnings: [] });
const text = (v: unknown, limit = 300): string => typeof v === "string" ? v.slice(0, limit) : "";
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.slice(0, 500).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const severity = (v: unknown): Severity => v === "high" || v === "medium" || v === "low" ? v : "none";
const findings = (v: unknown): Finding[] => list(v).slice(0, 100).map(f => ({
  ruleId: text(f.ruleId, 100), title: text(f.title, 250), severity: severity(f.severity),
  // Only display rule and title here: scanner-generated detail/fix text can
  // include unsanitized remote responses in older report versions.
  detail: "", fix: ""
}));
function supplement(raw: unknown): ScanSupplement {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyDetails();
  const r = raw as Record<string, unknown>;
  return {
    servers: list(r.servers).map(x => ({
      name: text(x.name, 130), app: text(x.app, 100), configPath: text(x.configPath, 350),
      scope: text(x.scope, 350), transport: text(x.transport, 30), disabled: x.disabled === true,
      risk: severity(x.risk), envKeys: Array.isArray(x.envKeys) ? x.envKeys.filter((v):v is string=>typeof v==="string").slice(0,100).map(v=>v.slice(0,100)) : [],
      headerKeys: Array.isArray(x.headerKeys) ? x.headerKeys.filter((v):v is string=>typeof v==="string").slice(0,100).map(v=>v.slice(0,100)) : [],
      protectedKeys: list(x.protectedSecrets).map(v=>text(v.env,100)).filter(Boolean),
      findings: findings(x.findings)
    })),
    configs: list(r.configs).map(x => ({
      app: text(x.app, 80), path: text(x.path, 350),
      found: x.found === true, servers: typeof x.servers === "number" ? x.servers : 0,
      error: x.error ? "Configuration could not be read" : ""
    })),
    skills: list(r.skills).map(x => ({ name: text(x.name, 130), source: text(x.source, 100), risk: severity(x.risk), findings: findings(x.findings) })),
    tools: list(r.tools).map(x => ({ name: text(x.name, 130), server: text(x.server, 130), risk: severity(x.risk), findings: findings(x.findings) })),
    probes: list(r.toolProbes).map(x => ({ server: text(x.server, 130), count: typeof x.tools === "number" ? x.tools : 0, error: x.error ? "Probe unavailable or failed" : "" })),
    pathWarnings: list(r.pathWarnings).map(x => ({ app: text(x.app, 80), reason: text(x.reason, 100), severity: text(x.severity, 30), detail: text(x.reason, 100).replaceAll("_", " ") }))
  };
}
function build(row: DeviceDbRow, demo: boolean): Endpoint {
  const raw = row.report;
  let agents: Agent[] = [];
  const incomplete: string[] = [];
  let scannerVersion: string | null = null;
  let details = emptyDetails();
  if (raw) {
    try {
      const imported = importScan(raw);
      agents = imported.agents;
      incomplete.push(...(imported.warnings || []));
      const r = raw as Record<string, unknown>;
      scannerVersion = text(r.scannerVersion, 40) || null;
      details = supplement(raw);
    } catch {
      incomplete.push("The latest scan report is invalid or unsupported.");
    }
  }
  const severityCounts = { high: 0, medium: 0, low: 0 };
  for (const finding of agents.flatMap(a => a.findings)) {
    if (finding.severity === "high") severityCounts.high++;
    if (finding.severity === "medium") severityCounts.medium++;
    if (finding.severity === "low") severityCounts.low++;
  }
  for (const item of [...details.skills, ...details.tools]) {
    for (const f of item.findings) {
      if (f.severity === "high") severityCounts.high++;
      if (f.severity === "medium") severityCounts.medium++;
      if (f.severity === "low") severityCounts.low++;
    }
  }
  const scannedAt = row.last_scan_at?.toISOString() || null;
  const isStale = scannedAt ? Date.now() - new Date(scannedAt).getTime() > 7 * 86400000 : false;
  return {
    id: row.id, clientId: row.client_id, clientName: row.client_name,
    hostname: row.hostname, os: row.os || "Unknown", lastScan: scannedAt,
    scannerVersion, high: severityCounts.high, medium: severityCounts.medium, low: severityCounts.low,
    status: !raw ? "never" : incomplete.length ? "incomplete" : isStale ? "stale" :
      severityCounts.high || severityCounts.medium ? "attention" : "healthy",
    applications: Array.from(new Set(agents.map(x => x.app))).sort(),
    agents, details, incomplete, demo
  };
}
function demoInventory(): Endpoint[] {
  return demoClients.flatMap(client => {
    const byHost = new Map<string, Agent[]>();
    for (const a of client.agents) {
      if (a.source !== "Laptop scan") continue;
      const host = a.location.split(" · ")[0];
      byHost.set(host, [...(byHost.get(host) || []), a]);
    }
    return [...byHost.entries()].map(([hostname, agents]) => {
      const row: DeviceDbRow = {
        id: "demo-" + client.id + "-" + hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        client_id: client.id, client_name: client.name, hostname, os: "Demo device",
        last_scan_at: new Date(client.lastScan),
        report: { schemaVersion: 1, scannerVersion: "demo", hostname, scannedAt: client.lastScan,
          servers: agents.map(a => ({
            name: a.name, app: a.app, configPath: a.configPath || "",
            findings: a.findings, protectedSecrets: (a.protectedKeys || []).map(env => ({env}))
          })) }
      };
      return build(row, true);
    });
  });
}
export async function loadDevices(clientId?: string): Promise<Endpoint[]> {
  if (!hasDatabase()) return demoInventory().filter(d => !clientId || d.clientId === clientId);
  const session = await requireSession();
  if (clientId && !/^[a-f0-9-]{36}$/i.test(clientId)) return [];
  const rows = await withTenant(session.mspId, async db => (await db.query<DeviceDbRow>(
    "select d.id, d.client_id, c.name as client_name, d.hostname, d.os, d.last_scan_at, last.report " +
    "from devices d join clients c on c.id = d.client_id " +
    "left join lateral (select s.report from scans s where s.device_id = d.id " +
    "order by s.scanned_at desc, s.received_at desc limit 1) last on true " +
    "where ($1::uuid is null or d.client_id = $1::uuid) order by c.name, d.hostname limit 2000",
    [clientId || null]
  )).rows);
  return rows.map(r => build(r, false));
}
export async function loadDeviceById(id: string): Promise<Endpoint | undefined> {
  if (id.startsWith("demo-") && !hasDatabase()) return demoInventory().find(d => d.id === id);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !hasDatabase()) return undefined;
  const session = await requireSession();
  const rows = await withTenant(session.mspId, async db => (await db.query<DeviceDbRow>(
    "select d.id, d.client_id, c.name as client_name, d.hostname, d.os, d.last_scan_at, s.report " +
    "from devices d join clients c on c.id=d.client_id " +
    "left join lateral (select report from scans where device_id=d.id order by scanned_at desc, received_at desc limit 1) s on true " +
    "where d.id=$1 limit 1", [id]
  )).rows);
  return rows[0] ? build(rows[0], false) : undefined;
}