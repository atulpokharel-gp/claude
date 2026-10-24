// Turns a JSON report from the zinloop scanner into a Client the console can show.
// Runs in the browser; the file never leaves the viewer's computer.

import type { Agent, Client, Finding, Severity } from "./types.ts";

const SEVERITIES: Severity[] = ["high", "medium", "low", "none"];

export class ScanImportError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function toFinding(v: unknown): Finding | null {
  if (!isObj(v)) return null;
  const severity = str(v.severity) as Severity;
  if (!SEVERITIES.includes(severity)) return null;
  return {
    ruleId: str(v.ruleId, "UNKNOWN"),
    severity,
    title: str(v.title),
    detail: str(v.detail),
    fix: str(v.fix),
  };
}

function reachFor(s: Record<string, unknown>): string[] {
  const url = str(s.url);
  if (url) {
    try {
      return [`Remote service at ${new URL(url).hostname}`];
    } catch {
      return ["Remote service"];
    }
  }
  const cmd = [str(s.command), ...strList(s.args)].join(" ").trim();
  return cmd ? [`Runs: ${cmd}`] : [];
}

export function importScan(json: unknown): Client {
  if (!isObj(json) || json.schemaVersion !== 1 || !Array.isArray(json.servers)) {
    throw new ScanImportError(
      "This file isn't an zinloop report. Run `zinloop --json --out scan.json` and choose scan.json.",
    );
  }
  const host = str(json.hostname, "this computer");
  const scannedAt = str(json.scannedAt, new Date().toISOString());
  const agents: Agent[] = [];
  json.servers.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const findings = (Array.isArray(raw.findings) ? raw.findings : [])
      .map(toFinding)
      .filter((f): f is Finding => f !== null);
    const scope = str(raw.scope);
    agents.push({
      id: `scan-${i}`,
      name: str(raw.name, `server ${i + 1}`),
      kind: "mcp-server",
      source: "Laptop scan",
      location: scope ? `${host} · ${scope}` : host,
      app: str(raw.app, "Unknown app"),
      reach: reachFor(raw),
      findings,
      revocable: false,
      lastSeen: scannedAt.slice(0, 10),
      protectedKeys: (Array.isArray(raw.protectedSecrets) ? raw.protectedSecrets : [])
        .map((p) => (isObj(p) ? str(p.env) : ""))
        .filter(Boolean),
    });
  });
  // Config files the scanner found but couldn't read. Their servers are missing,
  // so the result is incomplete and must say so.
  const warnings: string[] = [];
  for (const c of Array.isArray(json.configs) ? json.configs : []) {
    if (isObj(c) && str(c.error)) {
      warnings.push(`Couldn't read ${str(c.path, "a config file")} (${str(c.app, "unknown app")}): ${str(c.error)}`);
    }
  }
  return {
    id: "imported",
    name: `Scan of ${host}`,
    industry: `Uploaded report · ${str(json.os, "unknown OS")}`,
    staff: 1,
    devices: 1,
    // A device where a config failed to read counts as not fully scanned.
    devicesScanned: warnings.length > 0 ? 0 : 1,
    lastScan: scannedAt,
    agents,
    warnings,
  };
}
