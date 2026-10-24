import { test } from "node:test";
import assert from "node:assert/strict";
import { attention, peopleFrom, snapshotOf, toolsFrom } from "./insights.ts";
import { clients } from "./sample-data.ts";
import { personFor } from "./scan-import.ts";
import type { Agent, Client } from "./types.ts";

const agent = (over: Partial<Agent>): Agent => ({
  id: Math.random().toString(36).slice(2), name: "github", kind: "mcp-server", source: "Laptop scan", location: "PC-1 · Cursor",
  app: "Cursor", reach: [], findings: [], revocable: false, lastSeen: "2026-10-20", ...over,
});
const client = (id: string, agents: Agent[], over: Partial<Client> = {}): Client => ({
  id, name: id.toUpperCase(), industry: "", staff: 10, devices: 2, devicesScanned: 2, lastScan: "2026-10-23T00:00:00Z", agents, ...over,
});
const high = { ruleId: "SECRET_IN_CONFIG", severity: "high" as const, title: "Credential stored in plain text", detail: "", fix: "" };

test("people merge a laptop profile with the same person's Microsoft 365 sign-in", () => {
  const c = client("acme", [
    agent({ name: "github", findings: [high], people: [{ key: "d.reyes", name: "d.reyes" }] }),
    agent({ name: "InboxPilot", source: "Microsoft 365", kind: "oauth-app", location: "Acme Microsoft 365 · 1 user", people: [{ key: "d.reyes", name: "Dana Reyes", email: "d.reyes@acme.example" }] }),
    agent({ name: "time", location: "PC-2 · VS Code", people: [{ key: "sam", name: "sam" }] }),
  ]);
  const people = peopleFrom([c]);
  assert.equal(people.length, 2);
  const dana = people[0];
  assert.equal(dana.name, "Dana Reyes");
  assert.equal(dana.email, "d.reyes@acme.example");
  assert.deepEqual(dana.devices, ["PC-1"]);
  assert.deepEqual(dana.tools.map((t) => t.name), ["github", "InboxPilot"]);
  assert.equal(dana.risk, "high");
  // The same key at another client is a different person.
  assert.equal(peopleFrom([c, client("other", [agent({ people: [{ key: "d.reyes", name: "d.reyes" }] })])]).length, 3);
});

test("tools are listed once with every client that uses them", () => {
  const tools = toolsFrom([
    client("a", [agent({ name: "GitHub", findings: [high], people: [{ key: "x", name: "x" }] })]),
    client("b", [agent({ name: "github", people: [{ key: "y", name: "y" }] }), agent({ name: "time" })]),
  ]);
  const gh = tools.find((t) => t.key === "github")!;
  assert.equal(gh.clients.length, 2);
  assert.equal(gh.people, 2);
  assert.equal(gh.count, 2);
  assert.equal(gh.risk, "high");
  assert.equal(gh.topFinding, "Credential stored in plain text");
  assert.equal(tools[0].key, "github", "riskiest first");
});

test("needs attention lists high risk first, then clients that stopped reporting", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const items = attention(
    [
      client("quiet", [], { lastScan: "2026-10-01T00:00:00Z" }),
      client("risky", [agent({ findings: [high] })]),
      client("partial", [], { devices: 10, devicesScanned: 3 }),
      client("fine", [agent({})]),
    ],
    now,
  );
  assert.deepEqual(items.map((i) => [i.clientId, i.kind]), [["risky", "high"], ["quiet", "stale"], ["partial", "coverage"]]);
  assert.match(items[1].text, /23 days/);
});

test("snapshots count tools by their worst finding", () => {
  const s = snapshotOf(client("a", [agent({ findings: [high], people: [{ key: "p", name: "p" }] }), agent({})]));
  assert.deepEqual(s, { high: 1, medium: 0, low: 0, tools: 2, people: 1 });
});

test("laptop configs are linked to the profile they were found in", () => {
  assert.deepEqual(personFor({ user: "alice" }), { key: "alice", name: "alice" });
  assert.deepEqual(personFor({ configPath: "C:\\Users\\Bob.Smith\\AppData\\Roaming\\Claude\\claude_desktop_config.json" }), { key: "bob.smith", name: "Bob.Smith" });
  assert.deepEqual(personFor({ configPath: "/home/carol/.cursor/mcp.json" }), { key: "carol", name: "carol" });
  assert.equal(personFor({ configPath: "/etc/x.json" }), undefined);
  assert.equal(personFor({ user: "root" }), undefined);
});

test("the demo data has people on every client", () => {
  const people = peopleFrom(clients);
  assert.ok(people.length >= 10);
  for (const c of clients) assert.ok(people.some((p) => p.clientId === c.id), `${c.name} has people`);
});
