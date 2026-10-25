// Scan-to-scan diffs: what changed on one laptop since its last scan. Pure
// functions over the scanner's raw JSON reports, so they can be tested
// without a database.

import { createHash } from "node:crypto";

export const SEVERITY_RANK = { high: 4, medium: 3, low: 2, none: 1 } as const;
export type Severity = keyof typeof SEVERITY_RANK;

/** One server in a report, as the scanner emits it. We only pick the parts the diff cares about. */
export interface RawServer {
  name?: string;
  app?: string;
  configPath?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  findings?: Array<{ ruleId?: string; severity?: Severity; title?: string }>;
}

export interface RawReport {
  schemaVersion?: number;
  hostname?: string;
  servers?: RawServer[];
}

export interface ServerSummary {
  key: string;
  name: string;
  app: string;
  configPath: string;
  worstRisk: Severity;
  rules: string[]; // ruleIds, sorted
}

export interface FindingChange {
  severity: Severity;
  title: string;
  ruleId: string;
}

export interface ChangedServer {
  key: string;
  name: string;
  app: string;
  configPath: string;
  before: { worstRisk: Severity; rules: string[] };
  after: { worstRisk: Severity; rules: string[] };
  addedFindings: FindingChange[];
  removedFindings: FindingChange[];
}

export interface ReturnedFinding {
  key: string;
  name: string;
  app: string;
  configPath: string;
  ruleId: string;
  severity: Severity;
  title: string;
}

export interface ScanDelta {
  added: ServerSummary[];
  removed: ServerSummary[];
  changed: ChangedServer[];
  returned: ReturnedFinding[];
  counts: {
    added: number;
    removed: number;
    changed: number;
    riskUp: number;
    riskDown: number;
    returned: number;
  };
}

/** A server's identity across scans: config file + name, falling back to name alone. */
export function serverKey(s: RawServer): string {
  const name = (s.name ?? "").trim().toLowerCase();
  const path = (s.configPath ?? "").trim();
  // Config path can be very long and case-sensitive on Linux, so hash it to
  // keep keys bounded without losing uniqueness.
  const pathKey = path ? createHash("sha256").update(path).digest("hex").slice(0, 16) : "";
  return pathKey ? `${pathKey}:${name}` : `:${name}`;
}

function severityOrNone(v: unknown): Severity {
  return v === "high" || v === "medium" || v === "low" || v === "none" ? v : "none";
}

function worstOf(findings: RawServer["findings"]): Severity {
  let worst: Severity = "none";
  for (const f of findings ?? []) {
    const s = severityOrNone(f?.severity);
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

function rulesOf(findings: RawServer["findings"]): string[] {
  const out = new Set<string>();
  for (const f of findings ?? []) {
    const r = typeof f?.ruleId === "string" ? f.ruleId.trim() : "";
    if (r) out.add(r);
  }
  return [...out].sort();
}

/** A short, bounded value that only changes when a server's content changes. */
function serverContentHash(s: RawServer): string {
  // Order-insensitive view of the server's "interesting" fields. Config
  // comments and whitespace don't matter; env/args/url etc. do.
  const findings = (s.findings ?? [])
    .map((f) => `${severityOrNone(f?.severity)}:${typeof f?.ruleId === "string" ? f.ruleId : ""}:${typeof f?.title === "string" ? f.title : ""}`)
    .sort()
    .join("|");
  const env = Object.keys(s.env ?? {}).sort().join(",");
  const headers = Object.keys(s.headers ?? {}).sort().join(",");
  const h = createHash("sha256");
  h.update(JSON.stringify({
    name: s.name ?? "",
    app: s.app ?? "",
    command: s.command ?? "",
    args: Array.isArray(s.args) ? s.args : [],
    url: s.url ?? "",
    envKeys: env,
    headerKeys: headers,
    findings,
  }));
  return h.digest("hex").slice(0, 24);
}

function summaryOf(s: RawServer): ServerSummary {
  return {
    key: serverKey(s),
    name: (s.name ?? "").slice(0, 200),
    app: (s.app ?? "").slice(0, 200),
    configPath: (s.configPath ?? "").slice(0, 500),
    worstRisk: worstOf(s.findings),
    rules: rulesOf(s.findings),
  };
}

function diffFindings(before: RawServer["findings"], after: RawServer["findings"]): { added: FindingChange[]; removed: FindingChange[] } {
  const toSet = (fs: RawServer["findings"]) => {
    const out = new Map<string, FindingChange>();
    for (const f of fs ?? []) {
      const ruleId = typeof f?.ruleId === "string" ? f.ruleId.trim() : "";
      if (!ruleId) continue;
      if (!out.has(ruleId)) {
        out.set(ruleId, {
          ruleId,
          severity: severityOrNone(f?.severity),
          title: (typeof f?.title === "string" ? f.title : "").slice(0, 300),
        });
      }
    }
    return out;
  };
  const b = toSet(before);
  const a = toSet(after);
  const added: FindingChange[] = [];
  const removed: FindingChange[] = [];
  for (const [id, f] of a) if (!b.has(id)) added.push(f);
  for (const [id, f] of b) if (!a.has(id)) removed.push(f);
  return { added, removed };
}

/**
 * Diff two scans, optionally with the one before that so a finding that
 * disappeared and came back can be reported as "returned". `prev` is the
 * most recent scan older than `now`; `prevPrev` is one before that.
 */
export function diffScans(prev: RawReport | null, now: RawReport, prevPrev?: RawReport | null): ScanDelta {
  const nowServers = (now.servers ?? []).filter((s): s is RawServer => !!s && typeof s === "object");
  const prevServers = ((prev?.servers ?? []) as RawServer[]).filter((s) => !!s && typeof s === "object");
  const prevPrevServers = ((prevPrev?.servers ?? []) as RawServer[]).filter((s) => !!s && typeof s === "object");

  const nowByKey = new Map<string, RawServer>();
  for (const s of nowServers) nowByKey.set(serverKey(s), s);
  const prevByKey = new Map<string, RawServer>();
  for (const s of prevServers) prevByKey.set(serverKey(s), s);
  const prevPrevByKey = new Map<string, RawServer>();
  for (const s of prevPrevServers) prevPrevByKey.set(serverKey(s), s);

  const added: ServerSummary[] = [];
  const removed: ServerSummary[] = [];
  const changed: ChangedServer[] = [];
  const returned: ReturnedFinding[] = [];

  if (!prev) {
    // First scan on this device: everything is "new", but don't flood as
    // "added" — treat it as the baseline (empty delta).
    return {
      added: [], removed: [], changed: [], returned: [],
      counts: { added: 0, removed: 0, changed: 0, riskUp: 0, riskDown: 0, returned: 0 },
    };
  }

  for (const [key, nowS] of nowByKey) {
    const prevS = prevByKey.get(key);
    if (!prevS) {
      added.push(summaryOf(nowS));
      continue;
    }
    if (serverContentHash(prevS) === serverContentHash(nowS)) continue;
    const findings = diffFindings(prevS.findings, nowS.findings);
    changed.push({
      key,
      name: (nowS.name ?? "").slice(0, 200),
      app: (nowS.app ?? "").slice(0, 200),
      configPath: (nowS.configPath ?? "").slice(0, 500),
      before: { worstRisk: worstOf(prevS.findings), rules: rulesOf(prevS.findings) },
      after: { worstRisk: worstOf(nowS.findings), rules: rulesOf(nowS.findings) },
      addedFindings: findings.added,
      removedFindings: findings.removed,
    });
  }

  for (const [key, prevS] of prevByKey) {
    if (!nowByKey.has(key)) removed.push(summaryOf(prevS));
  }

  // "Returned" findings: a rule present in this scan AND in the scan two
  // scans ago, but absent in the most recent scan. This is the signal that
  // a fix was applied and then the risky config came back.
  if (prevPrev) {
    for (const [key, nowS] of nowByKey) {
      const olderS = prevPrevByKey.get(key);
      if (!olderS) continue;
      const prevS = prevByKey.get(key);
      const nowRules = new Set(rulesOf(nowS.findings));
      const prevRules = new Set(rulesOf(prevS?.findings));
      const olderRules = new Set(rulesOf(olderS.findings));
      for (const r of nowRules) {
        if (olderRules.has(r) && !prevRules.has(r)) {
          const match = (nowS.findings ?? []).find((f) => f?.ruleId === r);
          returned.push({
            key,
            name: (nowS.name ?? "").slice(0, 200),
            app: (nowS.app ?? "").slice(0, 200),
            configPath: (nowS.configPath ?? "").slice(0, 500),
            ruleId: r,
            severity: severityOrNone(match?.severity),
            title: (typeof match?.title === "string" ? match.title : "").slice(0, 300),
          });
        }
      }
    }
  }

  let riskUp = 0;
  let riskDown = 0;
  for (const c of changed) {
    const b = SEVERITY_RANK[c.before.worstRisk];
    const a = SEVERITY_RANK[c.after.worstRisk];
    if (a > b) riskUp++;
    else if (a < b) riskDown++;
  }

  return {
    added,
    removed,
    changed,
    returned,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      riskUp,
      riskDown,
      returned: returned.length,
    },
  };
}

/** Compacts a delta to under ~64 KB for storage, keeping the most important rows. */
export function trimDelta(d: ScanDelta): ScanDelta {
  const cap = 100;
  return {
    added: d.added.slice(0, cap),
    removed: d.removed.slice(0, cap),
    changed: d.changed.slice(0, cap),
    returned: d.returned.slice(0, cap),
    counts: d.counts, // counts are the full totals, not the trimmed lists
  };
}

export function hasAnyChange(d: ScanDelta): boolean {
  return d.counts.added + d.counts.removed + d.counts.changed + d.counts.returned > 0;
}
