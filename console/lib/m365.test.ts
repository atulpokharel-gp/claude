import { test } from "node:test";
import assert from "node:assert/strict";
import { appToAgent, discover, GraphError, isAiApp, revokeApp, verifyAdmin, verifyUrl } from "./m365.ts";
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
  // Named people who approved it; tools approved for everyone list nobody.
  assert.deepEqual(inbox.people, [{ key: "d.reyes@contoso.example", name: "Dana Reyes", email: "d.reyes@contoso.example" }]);
  assert.deepEqual(chat.people, []);

  // Two grants from the same person (to different APIs) are still one person.
  const app = apps.find((a) => a.name === "InboxPilot AI")!;
  const twice = appToAgent({ ...app, grants: [...app.grants, { ...app.grants[0], id: "g1-other-api", scopes: ["User.Read"] }] }, "Acme", "2026-10-24T09:00:00Z");
  assert.equal(twice.people!.length, 1);
  assert.match(twice.findings[0].title, /1 person/);
  assert.match(twice.location, /1 user$/);
});

test("apps are still listed when Microsoft won't give out names", async () => {
  const g = fakeGraph();
  const base = g.fetch;
  const noNames = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).includes("/users?") ? new Response(JSON.stringify({ error: { message: "Insufficient privileges" } }), { status: 403 }) : base(input, init)) as typeof fetch;
  const apps = await discover(TENANT, noNames);
  const inbox = appToAgent(apps.find((a) => a.name === "InboxPilot AI")!, "Acme", "2026-10-24T09:00:00Z");
  assert.deepEqual(inbox.people, []);
  assert.equal(inbox.findings[0].ruleId, "M365_USER_GRANT");
});

test("apps are still saved when the name lookup hits a network error", async () => {
  const g = fakeGraph();
  const base = g.fetch;
  const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("/users?")) throw new TypeError("fetch failed: connection reset");
    return base(input, init);
  }) as typeof fetch;
  const apps = await discover(TENANT, flaky);
  assert.ok(apps.find((a) => a.name === "InboxPilot AI"));
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

// verifyAdmin: the sign-in after consent must prove the admin is in that tenant.
function tokenFetch(claims: Record<string, unknown>, status = 200): typeof fetch {
  const idToken = ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
  return (async () => new Response(JSON.stringify(status === 200 ? { id_token: idToken } : { error_description: "AADSTS54005: code already used" }), { status })) as typeof fetch;
}
const GLOBAL_ADMIN = "62e90394-69f5-4237-9190-012177145e10";

test("verifyAdmin accepts an admin of the approved tenant", async () => {
  await verifyAdmin(TENANT, "code", "https://x/cb", tokenFetch({ aud: "test-client", tid: TENANT, wids: [GLOBAL_ADMIN] }));
});

test("verifyAdmin rejects a sign-in to another tenant", async () => {
  await assert.rejects(
    verifyAdmin(TENANT, "code", "https://x/cb", tokenFetch({ aud: "test-client", tid: "99999999-2222-3333-4444-555555555555", wids: [GLOBAL_ADMIN] })),
    (e: GraphError) => e.status === 403,
  );
});

test("verifyAdmin rejects a user who isn't an admin, or a token for another app", async () => {
  await assert.rejects(verifyAdmin(TENANT, "code", "https://x/cb", tokenFetch({ aud: "test-client", tid: TENANT, wids: [] })), (e: GraphError) => e.status === 403);
  await assert.rejects(verifyAdmin(TENANT, "code", "https://x/cb", tokenFetch({ aud: "other-app", tid: TENANT, wids: [GLOBAL_ADMIN] })), (e: GraphError) => e.status === 403);
  await assert.rejects(verifyAdmin(TENANT, "code", "https://x/cb", tokenFetch({}, 400)), GraphError);
});

test("verifyUrl signs in at the claimed tenant only", () => {
  assert.match(verifyUrl(TENANT, "s", "https://x/cb"), new RegExp(`^https://login\\.microsoftonline\\.com/${TENANT}/oauth2/v2\\.0/authorize\\?`));
  assert.throws(() => verifyUrl("organizations", "s", "https://x/cb"), GraphError);
});
