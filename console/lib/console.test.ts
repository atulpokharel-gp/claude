import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importScan, ScanImportError } from "./scan-import.ts";
import { clientScore, countRisk, keyCounts, sortAgents, worst } from "./risk.ts";
import { clients } from "./sample-data.ts";

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL("../public/sample-scan.json", import.meta.url)), "utf8"),
);

test("imports a real scanner report", () => {
  const c = importScan(sample);
  assert.equal(c.agents.length, sample.servers.length);
  const counts = countRisk(c.agents);
  assert.equal(counts.high, sample.summary.high);
  assert.equal(counts.medium, sample.summary.medium);
  assert.equal(counts.none, sample.summary.clean);
});

test("rejects files that are not scanner reports", () => {
  assert.throws(() => importScan({ hello: "world" }), ScanImportError);
  assert.throws(() => importScan([]), ScanImportError);
  assert.throws(() => importScan(null), ScanImportError);
});

test("drops findings with unknown severities instead of crashing", () => {
  const c = importScan({
    schemaVersion: 1,
    servers: [{ name: "x", findings: [{ severity: "critical", title: "?" }, { severity: "low", title: "ok" }] }],
  });
  assert.equal(c.agents[0].findings.length, 1);
});

test("worst picks the highest severity", () => {
  assert.equal(worst([]), "none");
  assert.equal(
    worst([
      { ruleId: "a", severity: "low", title: "", detail: "", fix: "" },
      { ruleId: "b", severity: "high", title: "", detail: "", fix: "" },
    ]),
    "high",
  );
});

test("sample clients sort with riskiest agents first and scores in range", () => {
  for (const c of clients) {
    const s = clientScore(c);
    assert.ok(s >= 0 && s <= 100, `${c.name} score ${s}`);
    const sorted = sortAgents(c.agents);
    const ranks = sorted.map((a) => ({ high: 3, medium: 2, low: 1, none: 0 })[worst(a.findings)]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  }
});

test("keeps config read errors and marks the scan incomplete", () => {
  const c = importScan({
    schemaVersion: 1,
    hostname: "pc1",
    servers: [],
    configs: [
      { app: "Cursor", path: "/home/a/.cursor/mcp.json", found: true, error: "parse failed" },
      { app: "VS Code", path: "/home/a/x.json", found: false },
    ],
  });
  assert.equal(c.warnings?.length, 1);
  assert.match(c.warnings![0], /\.cursor\/mcp\.json.*parse failed/);
  assert.equal(c.devicesScanned, 0);
});

test("a skipped server entry shows up as a warning", () => {
  const c = importScan(sample);
  assert.equal(c.warnings?.length, 1);
  assert.match(c.warnings![0], /broken/);
  assert.equal(c.devicesScanned, 0);
});

test("a clean scan has no warnings and counts as scanned", () => {
  const clean = { ...sample, configs: sample.configs.map(({ error: _e, ...c }: { error?: string }) => c) };
  const c = importScan(clean);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.devicesScanned, 1);
});

test("reads keys protected by the fix command", () => {
  const c = importScan({
    schemaVersion: 1,
    servers: [{ name: "gh", protectedSecrets: [{ env: "GITHUB_TOKEN", ref: "claude-desktop/gh/GITHUB_TOKEN" }], findings: [] }],
  });
  assert.deepEqual(c.agents[0].protectedKeys, ["GITHUB_TOKEN"]);
});

test("refuses a report with far too many servers", () => {
  const many = { schemaVersion: 1, hostname: "pc", servers: new Array(1000).fill({ name: "x", findings: [] }) };
  assert.throws(() => importScan(many), /Too many servers/);
});

test("caps findings per server so a hostile report can't explode memory", () => {
  const flood = {
    schemaVersion: 1,
    hostname: "pc",
    servers: [
      {
        name: "x",
        findings: new Array(500).fill({ severity: "low", ruleId: "R", title: "t", detail: "d", fix: "f" }),
      },
    ],
  };
  const c = importScan(flood);
  assert.ok(c.agents[0].findings.length <= 100);
});

test("caps extremely long strings in a report", () => {
  const long = "x".repeat(10_000);
  const c = importScan({
    schemaVersion: 1,
    hostname: "pc",
    servers: [{ name: long, app: long, findings: [{ severity: "low", title: long, detail: long, fix: long, ruleId: "R" }] }],
  });
  assert.ok(c.agents[0].name.length <= 2000);
  assert.ok(c.agents[0].findings[0].detail.length <= 2000);
});

test("a protected server still awaiting rotation is not counted as done", () => {
  const base = { id: "x", kind: "mcp-server" as const, source: "Laptop scan" as const, location: "pc", app: "Cursor", reach: [] as string[], revocable: false, lastSeen: "2026-10-23" };
  const f = (ruleId: string) => ({ ruleId, severity: "medium" as const, title: "", detail: "", fix: "" });
  const counts = keyCounts([
    { ...base, name: "done", findings: [], protectedKeys: ["A"] },
    { ...base, name: "rotate", findings: [f("KEY_NOT_ROTATED")], protectedKeys: ["B"] },
    { ...base, name: "mixed", findings: [f("SECRET_IN_CONFIG")], protectedKeys: ["C"] },
  ]);
  assert.deepEqual(counts, { plain: 1, toReplace: 1, done: 1 });
});
