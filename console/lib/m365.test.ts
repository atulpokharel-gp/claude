import { test } from "node:test";
import assert from "node:assert/strict";
import { appToAgent, discover, isAiApp, revokeApp } from "./m365.ts";
import { fakeGraph, TENANT } from "./m365-fake.ts";

process.env.M365_CLIENT_ID = "test-client";
process.env.M365_CLIENT_SECRET = "test-secret";

test("discovery finds AI apps with grants and skips Microsoft's and non-AI apps", async () => {
  const g = fakeGraph();
  const apps = await discover(TENANT, g.fetch);
  assert.deepEqual(apps.map((a) => a.name).sort(), ["ChatGPT", "InboxPilot AI", "Meeting Notes Bot"]);
  const notes = apps.find((a) => a.name === "Meeting Notes Bot")!;
  assert.deepEqual(notes.appRoles.map((r) => r.value), ["Mail.Read.All"]);
  const inbox = apps.find((a) => a.name === "InboxPilot AI")!;
  assert.deepEqual(inbox.grants[0].scopes, ["Mail.ReadWrite", "Mail.Send", "offline_access"]);
  assert.equal(inbox.verified, false);
  assert.ok(g.calls.some((c) => c.url.includes("skiptoken")), "follows paging links");
});

test("a tenant that never granted consent gives a readable error", async () => {
  await assert.rejects(discover("99999999-2222-3333-4444-555555555555", fakeGraph().fetch), /Application not found/);
  await assert.rejects(discover("not-a-tenant", fakeGraph().fetch), /tenant ID/);
});

test("findings describe how the access was granted", async () => {
  const apps = await discover(TENANT, fakeGraph().fetch);
  const by = (n: string) => appToAgent(apps.find((a) => a.name === n)!, "Acme", "2026-10-24T09:00:00Z");
  const notes = by("Meeting Notes Bot");
  assert.equal(notes.findings[0].ruleId, "M365_APP_ONLY_ACCESS");
  assert.equal(notes.findings[0].severity, "high");
  assert.ok(notes.reach.includes("Read every mailbox"));
  assert.equal(notes.revocable, true);
  assert.equal(notes.source, "Microsoft 365");

  const chat = by("ChatGPT");
  assert.deepEqual(chat.findings.map((f) => f.ruleId), ["M365_ORG_WIDE_GRANT"]);
  assert.match(chat.location, /approved for all users/);

  const inbox = by("InboxPilot AI");
  assert.deepEqual(inbox.findings.map((f) => f.ruleId), ["M365_USER_GRANT", "M365_UNVERIFIED_PUBLISHER"]);
  assert.match(inbox.findings[0].title, /1 person/);
});

test("revoking removes every grant the app holds", async () => {
  const g = fakeGraph();
  const apps = await discover(TENANT, g.fetch);
  await revokeApp(TENANT, apps.find((a) => a.name === "Meeting Notes Bot")!, g.fetch);
  await revokeApp(TENANT, apps.find((a) => a.name === "ChatGPT")!, g.fetch);
  assert.equal(g.assignments.length, 0);
  assert.ok(!g.grants.some((x) => x.id === "g2"));
  assert.deepEqual((await discover(TENANT, g.fetch)).map((a) => a.name), ["InboxPilot AI"]);
});

test("AI apps are recognized by name or publisher", () => {
  assert.ok(isAiApp({ displayName: "Claude", publisherName: "Anthropic" }));
  assert.ok(isAiApp({ displayName: "Notes", publisherName: "Otter.ai" }));
  assert.ok(!isAiApp({ displayName: "Payroll Sync", publisherName: "Payroll Co" }));
  assert.ok(!isAiApp({ displayName: "Microsoft 365 Copilot", appOwnerOrganizationId: "f8cdef31-a31e-4b4a-93e4-5f571e91255a" }));
});
