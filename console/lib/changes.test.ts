import { test } from "node:test";
import assert from "node:assert/strict";
import { diffScans, hasAnyChange, serverKey, trimDelta } from "./changes.ts";

const base = { schemaVersion: 1 as const, hostname: "pc1" };
const findSecret = { ruleId: "SECRET_IN_CONFIG", severity: "high" as const, title: "Plain-text API key" };
const findShell = { ruleId: "SHELL_ACCESS", severity: "high" as const, title: "Shell access" };
const findRemote = { ruleId: "REMOTE_SERVER", severity: "low" as const, title: "Remote server" };

test("the first scan on a device produces an empty delta (no false 'added')", () => {
  const d = diffScans(null, { ...base, servers: [{ name: "a", app: "Cursor", findings: [findShell] }] });
  assert.deepEqual(d.counts, { added: 0, removed: 0, changed: 0, riskUp: 0, riskDown: 0, returned: 0 });
});

test("a brand new server shows up as added", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor" }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor" }, { name: "b", app: "Claude Desktop", findings: [findShell] }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.added, 1);
  assert.equal(d.added[0].name, "b");
  assert.equal(d.added[0].worstRisk, "high");
});

test("a removed server is called out separately from a changed one", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor" }, { name: "b", app: "Cursor" }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor" }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.removed, 1);
  assert.equal(d.removed[0].name, "b");
  assert.equal(d.counts.changed, 0);
});

test("a server whose risk went up is counted as riskUp", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findRemote] }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findRemote, findSecret] }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.changed, 1);
  assert.equal(d.counts.riskUp, 1);
  assert.equal(d.changed[0].after.worstRisk, "high");
  assert.equal(d.changed[0].before.worstRisk, "low");
  assert.ok(d.changed[0].addedFindings.find((f) => f.ruleId === "SECRET_IN_CONFIG"));
});

test("a server whose risk went down is counted as riskDown and not surfaced as a regression", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findSecret] }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", findings: [] }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.riskDown, 1);
  assert.equal(d.counts.riskUp, 0);
});

test("a finding that was fixed and came back is reported as 'returned'", () => {
  const two = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findSecret] }] };
  const one = { ...base, servers: [{ name: "a", app: "Cursor", findings: [] }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findSecret] }] };
  const d = diffScans(one, now, two);
  assert.equal(d.counts.returned, 1);
  assert.equal(d.returned[0].ruleId, "SECRET_IN_CONFIG");
  assert.equal(d.returned[0].severity, "high");
});

test("a config path change gives the server a new identity (removed + added)", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor", configPath: "/home/x/.cursor/mcp.json" }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", configPath: "/home/x/.config/Claude/claude_desktop_config.json" }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.added, 1);
  assert.equal(d.counts.removed, 1);
  assert.equal(d.counts.changed, 0);
});

test("two scans with identical content have no changes", () => {
  const s = { ...base, servers: [{ name: "a", app: "Cursor", findings: [findShell] }, { name: "b", app: "Claude Desktop", findings: [findRemote] }] };
  const d = diffScans(s, s);
  assert.equal(hasAnyChange(d), false);
});

test("env/args/url changes are detected as a server change even when findings don't move", () => {
  const prev = { ...base, servers: [{ name: "a", app: "Cursor", env: { API_KEY: "x" }, findings: [findShell] }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", env: { API_KEY: "x", EXTRA: "y" }, findings: [findShell] }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.changed, 1);
});

test("envKeys/headerKeys arrays (what the scanner emits) are compared like env/headers maps", () => {
  // Scanner reports only the names of env variables, not the values, as an
  // array. Adding or removing a name must count as a change.
  const prev = { ...base, servers: [{ name: "a", app: "Cursor", envKeys: ["API_KEY"], findings: [findShell] }] };
  const now = { ...base, servers: [{ name: "a", app: "Cursor", envKeys: ["API_KEY", "EXTRA"], findings: [findShell] }] };
  const d = diffScans(prev, now);
  assert.equal(d.counts.changed, 1);
  // Same keys in a different order is not a change.
  const same = diffScans(
    { ...base, servers: [{ name: "a", app: "Cursor", envKeys: ["API_KEY", "EXTRA"], findings: [findShell] }] },
    { ...base, servers: [{ name: "a", app: "Cursor", envKeys: ["EXTRA", "API_KEY"], findings: [findShell] }] },
  );
  assert.equal(same.counts.changed, 0);
});

test("trimDelta caps huge lists but keeps count totals", () => {
  const servers = new Array(500).fill(null).map((_, i) => ({ name: `s${i}`, app: "Cursor" }));
  const d = diffScans(null, { ...base, servers });
  // first scan: empty delta, so trim is a no-op
  const t = trimDelta(d);
  assert.equal(t.counts.added, 0);
  // forced large delta
  const prev = { ...base, servers: [] };
  const now = { ...base, servers };
  const big = diffScans(prev, now);
  const trimmed = trimDelta(big);
  assert.ok(trimmed.added.length <= 100);
  assert.equal(trimmed.counts.added, 500);
});

test("serverKey is stable regardless of case in the name", () => {
  assert.equal(serverKey({ name: "GitHub", configPath: "/a" }), serverKey({ name: "github", configPath: "/a" }));
  assert.notEqual(serverKey({ name: "a", configPath: "/x" }), serverKey({ name: "a", configPath: "/y" }));
});
