import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report.ts";
import { clients, MSP_NAME } from "./sample-data.ts";
import type { Client } from "./types.ts";

test("the client report groups findings into actions, worst first", () => {
  const c = clients.find((x) => x.agents.some((a) => a.findings.some((f) => f.severity === "high")))!;
  const r = buildReport(c, MSP_NAME, new Date("2026-10-24T09:00:00Z"));
  assert.equal(r.clientName, c.name);
  assert.equal(r.preparedBy, MSP_NAME);
  assert.equal(r.date, "2026-10-24");
  assert.ok(r.actions.length > 0);
  assert.equal(r.actions[0].severity, "high");
  const ranks = { high: 0, medium: 1, low: 2, none: 3 };
  for (let i = 1; i < r.actions.length; i++) assert.ok(ranks[r.actions[i - 1].severity] <= ranks[r.actions[i].severity]);
  // Each rule and fix shows once, with every tool that has it counted.
  const total = c.agents.reduce((n, a) => n + a.findings.length, 0);
  assert.equal(r.actions.reduce((n, a) => n + a.tools, 0), total);
  assert.equal(new Set(r.actions.map((a) => `${a.ruleId}:${a.fix}`)).size, r.actions.length);
  assert.match(r.headline, /need(s)? action now/);
});

test("an empty client gets a plain explanation", () => {
  const empty: Client = { id: "x", name: "New Co", industry: "", staff: 0, devices: 10, devicesScanned: 0, lastScan: new Date(0).toISOString(), agents: [] };
  const r = buildReport(empty, "Harbor");
  assert.equal(r.actions.length, 0);
  assert.match(r.headline, /No laptops have reported yet/);
  assert.equal(r.laptopsExpected, 10);
});

test("findings with different fixes stay separate actions", () => {
  const agent = (id: string, ref: string): Client["agents"][number] => ({
    id, name: id, kind: "mcp-server", app: "Cursor", source: "Laptop scan", location: "PC-1 · Cursor", reach: [], revocable: false, lastSeen: new Date().toISOString(),
    findings: [{ ruleId: "KEY_NOT_ROTATED", severity: "medium", title: "Key not replaced yet", detail: "", fix: `zinloop rotate ${ref}` }],
  });
  const c: Client = { id: "x", name: "Two Keys", industry: "", staff: 1, devices: 1, devicesScanned: 1, lastScan: new Date().toISOString(), agents: [agent("a", "ref-a"), agent("b", "ref-b")] };
  const r = buildReport(c, "Harbor");
  assert.deepEqual(r.actions.map((a) => a.fix).sort(), ["zinloop rotate ref-a", "zinloop rotate ref-b"]);
});
