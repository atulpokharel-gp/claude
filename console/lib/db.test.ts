// Database tests. They need a Postgres server and run only when
// TEST_DATABASE_ADMIN_URL points at it (an owner connection, any database).
// Each run creates and drops its own database.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../scripts/migrate.ts";
import { createMsp } from "../scripts/create-msp.ts";
import { closePool, getPool, withTenant } from "./db.ts";
import { tokenHash } from "./secrets.ts";
import { checkSession, finishMfa, signIn, signOut } from "./auth.ts";
import {
  acceptInvite,
  changePassword,
  checkInvite,
  createInvite,
  enableTotp,
  getTeam,
  removeMember,
  signUp,
  startTotp,
} from "./accounts.ts";
import { codeAt, currentStep } from "./totp.ts";
import { cleanup } from "../scripts/cleanup.ts";
import { setPlan } from "../scripts/set-plan.ts";
import { snapshotAll } from "../scripts/snapshot.ts";
import {
  connectM365,
  createClient,
  createUploadToken,
  getClient,
  getTrend,
  ingestScan,
  listClients,
  revokeM365App,
  revokeUploadToken,
  syncM365,
  UploadError,
} from "./store.ts";
import { fakeGraph, TENANT } from "./m365-fake.ts";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
process.env.APP_SECRET ??= randomBytes(32).toString("base64");
const sample = JSON.parse(readFileSync(fileURLToPath(new URL("../public/sample-scan.json", import.meta.url)), "utf8"));

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

describe("database", { skip: !adminUrl && "set TEST_DATABASE_ADMIN_URL to run" }, () => {
  const dbName = `zinloop_test_${randomBytes(4).toString("hex")}`;
  const appPassword = randomBytes(12).toString("hex");
  let ownerUrl = "";
  let a: { mspId: string; password: string };
  let b: { mspId: string; password: string };

  before(async () => {
    // Migrate as an ordinary owner (no superuser, no BYPASSRLS), like a
    // managed database, so the lookups are tested under forced RLS.
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`do $$ begin
      if not exists (select from pg_roles where rolname = 'zinloop_test_owner') then
        create role zinloop_test_owner login createrole;
      end if; end $$`);
    await admin.query(`alter role zinloop_test_owner password '${appPassword}'`);
    await admin.query(`create database ${dbName} owner zinloop_test_owner`);
    const owner = new URL(withDb(adminUrl!, dbName));
    owner.username = "zinloop_test_owner";
    owner.password = appPassword;
    ownerUrl = owner.toString();
    await migrate(ownerUrl, () => {});
    await admin.query(`alter role zinloop_app login password '${appPassword}'`);
    await admin.end();
    const app = new URL(ownerUrl);
    app.username = "zinloop_app";
    app.password = appPassword;
    process.env.DATABASE_URL = app.toString();
    a = await createMsp(ownerUrl, "MSP A", "admin@a.example", "correct horse battery");
    b = await createMsp(ownerUrl, "MSP B", "admin@b.example");
  });

  after(async () => {
    await closePool();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  test("sign-in checks the password and sessions can be ended", async () => {
    assert.equal((await signIn("admin@a.example", "wrong")).kind, "wrong");
    assert.equal((await signIn("nobody@a.example", "correct horse battery")).kind, "wrong");
    const r = await signIn("ADMIN@a.example", "correct horse battery");
    assert.equal(r.kind, "session");
    const token = r.kind === "session" ? r.token : undefined;
    const s = await checkSession(token!);
    assert.equal(s?.mspId, a.mspId);
    assert.equal(s?.mspName, "MSP A");
    await signOut(s!, token!);
    assert.equal(await checkSession(token!), null);
    assert.equal(await checkSession("zls_made-up"), null);
  });

  test("the app role sees nothing without a tenant", async () => {
    await createClient(a.mspId, { name: "Hidden Co" });
    const res = await getPool().query("select count(*)::int as n from clients");
    assert.equal(res.rows[0].n, 0);
  });

  test("one MSP can't see or write another MSP's clients", async () => {
    const id = await createClient(a.mspId, { name: "Acme Dental", staff: 40, devicesExpected: 30 });
    assert.ok((await listClients(a.mspId)).some((c) => c.id === id));
    assert.ok(!(await listClients(b.mspId)).some((c) => c.id === id));
    assert.equal(await getClient(b.mspId, id), undefined);
    await assert.rejects(createUploadToken(b.mspId, id, "steal"), /Unknown client/);
    await assert.rejects(createClient(b.mspId, { name: "" }), /1 to 200/);
    // Even a hand-written insert can't put a row into another MSP.
    await assert.rejects(
      withTenant(b.mspId, (db) => db.query("insert into clients (msp_id, name) values ($1, 'x')", [a.mspId])),
      /row-level security/,
    );
  });

  test("laptop scans are stored for the token's client and shown", async () => {
    const id = await createClient(a.mspId, { name: "Scan Co", devicesExpected: 5 });
    const token = await createUploadToken(a.mspId, id, "RMM rollout");

    const now = new Date("2026-10-24T12:00:00Z");
    const future = { ...sample, hostname: "LAPTOP-1", scannedAt: "2030-01-01T00:00:00Z" };
    await ingestScan(token, future, now);
    await ingestScan(token, { ...sample, hostname: "LAPTOP-1" }, now); // second scan replaces the first in the view
    await ingestScan(token, { ...sample, hostname: "LAPTOP-2", configs: [] }, now);

    const got = await getClient(a.mspId, id, now);
    assert.ok(got);
    assert.equal(got.client.devices, 5);
    assert.equal(got.client.agents.length, sample.servers.length * 2);
    // LAPTOP-1's report has a config warning, so only LAPTOP-2 counts as fully scanned.
    assert.equal(got.client.devicesScanned, 1);
    assert.ok(got.client.warnings?.some((w) => w.startsWith("LAPTOP-1:")));
    assert.equal(got.tokens.length, 1);
    assert.ok(got.tokens[0].lastUsed);

    const stored = await getPool().query("select count(*)::int as n from scans"); // no tenant: invisible
    assert.equal(stored.rows[0].n, 0);
  });

  test("a late upload of an old scan doesn't count as fresh", async () => {
    const id = await createClient(a.mspId, { name: "Late Co", devicesExpected: 1 });
    const token = await createUploadToken(a.mspId, id, "");
    const now = new Date("2026-10-24T12:00:00Z");
    await ingestScan(token, { ...sample, configs: [], scannedAt: "2026-06-01T00:00:00Z" }, now);
    let got = await getClient(a.mspId, id, now);
    assert.equal(got!.client.devicesScanned, 0);

    // A fresh scan counts, and replaying the old one afterwards doesn't undo it.
    await ingestScan(token, { ...sample, configs: [], scannedAt: "2026-10-24T11:00:00Z" }, now);
    await ingestScan(token, { ...sample, configs: [], scannedAt: "2026-06-01T00:00:00Z" }, now);
    got = await getClient(a.mspId, id, now);
    assert.equal(got!.client.devicesScanned, 1);
  });

  test("upload tokens issued before the rename (agu_) still work", async () => {
    const id = await createClient(a.mspId, { name: "Legacy Co", devicesExpected: 1 });
    const legacy = "agu_" + randomBytes(32).toString("base64url");
    await withTenant(a.mspId, (db) =>
      db.query("insert into upload_tokens (msp_id, client_id, token_hash, label) values ($1, $2, $3, 'old')", [a.mspId, id, tokenHash(legacy)]),
    );
    await ingestScan(legacy, { ...sample, configs: [] });
    await assert.rejects(ingestScan("agu_nope", sample), (e: UploadError) => e.status === 401);
  });

  test("each scan saves the day's risk counts and the trend carries them forward", async () => {
    const id = await createClient(a.mspId, { name: "Trend Co", devicesExpected: 1 });
    const token = await createUploadToken(a.mspId, id, "");
    await ingestScan(token, { ...sample, hostname: "T-1", scannedAt: "2026-10-20T08:00:00Z" }, new Date("2026-10-20T09:00:00Z"));
    await ingestScan(token, { ...sample, hostname: "T-1", servers: [], scannedAt: "2026-10-23T08:00:00Z" }, new Date("2026-10-23T09:00:00Z"));
    const trend = await getTrend(a.mspId, 5, new Date("2026-10-24T12:00:00Z"), id);
    assert.deepEqual(trend.map((p) => p.day), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    const highOnDay1 = trend[0].high;
    assert.ok(highOnDay1 > 0, "sample scan has high-risk tools");
    assert.equal(trend[2].high, highOnDay1, "no scan on the 22nd: carries the 20th forward");
    assert.equal(trend[3].tools, 0, "the empty scan on the 23rd clears it");
    assert.equal(trend[4].tools, 0);
    // Another MSP sees none of it.
    assert.ok((await getTrend(b.mspId, 5, new Date("2026-10-24T12:00:00Z"))).every((p) => p.tools === 0));

    // The daily job writes a point for every client, even without new scans.
    const n = await snapshotAll(ownerUrl, new Date("2026-10-25T01:00:00Z"));
    assert.ok(n >= 1);
    const after = await getTrend(a.mspId, 1, new Date("2026-10-25T12:00:00Z"), id);
    assert.equal(after[0].day, "2026-10-25");
  });

  test("bad tokens and bad reports are refused", async () => {
    const id = await createClient(a.mspId, { name: "Refuse Co" });
    const token = await createUploadToken(a.mspId, id, "");
    await assert.rejects(ingestScan(undefined, sample), (e: UploadError) => e.status === 401);
    await assert.rejects(ingestScan("zlu_nope", sample), (e: UploadError) => e.status === 401);
    await assert.rejects(ingestScan(token, { hello: "world" }), (e: UploadError) => e.status === 400);
    await assert.rejects(ingestScan(token, { ...sample, hostname: "" }), (e: UploadError) => e.status === 400);

    const got = await getClient(a.mspId, id);
    await revokeUploadToken(a.mspId, got!.tokens[0].id);
    await assert.rejects(ingestScan(token, sample), (e: UploadError) => e.status === 401);
  });
  test("self-serve sign-up starts on the free plan with its limits", async () => {
    const token = await signUp({ name: "Sam Rivera", mspName: "Rivera IT", email: "Sam@Rivera.example", password: "long enough password", clientEstimate: 12 });
    const s = await checkSession(token);
    assert.equal(s?.mspName, "Rivera IT");
    const team = await getTeam(s!.mspId);
    assert.equal(team.plan, "free");
    assert.equal(team.members[0].role, "owner");
    assert.equal(team.members[0].email, "sam@rivera.example");

    await assert.rejects(
      signUp({ name: "x", mspName: "y", email: "sam@rivera.example", password: "long enough password" }),
      /already an account/,
    );
    await assert.rejects(signUp({ name: "x", mspName: "y", email: "new@rivera.example", password: "short" }), /12 characters/);
    await assert.rejects(signUp({ name: "x", mspName: "y", email: "not-an-email", password: "long enough password" }), /valid email/);

    const id = await createClient(s!.mspId, { name: "First client" });
    await assert.rejects(createClient(s!.mspId, { name: "Second client" }), /free plan covers 1 client/);

    const upload = await createUploadToken(s!.mspId, id, "");
    for (let i = 0; i < 25; i++) await ingestScan(upload, { ...sample, hostname: `PC-${i}` });
    await ingestScan(upload, { ...sample, hostname: "PC-0" }); // a known laptop can keep reporting
    await assert.rejects(ingestScan(upload, { ...sample, hostname: "PC-25" }), (e: UploadError) => e.status === 403);

    assert.equal(await setPlan(ownerUrl, "sam@rivera.example", "partner"), "Rivera IT");
    await ingestScan(upload, { ...sample, hostname: "PC-25" });
    await createClient(s!.mspId, { name: "Second client" });
  });

  test("two-factor sign-in needs a fresh code after the password", async () => {
    const token = await signUp({ name: "Two Factor", mspName: "TF IT", email: "tf@tf.example", password: "long enough password" });
    const s = (await checkSession(token))!;
    const secret = await startTotp(s.mspId, s.userId);
    await assert.rejects(enableTotp(s.mspId, s.userId, "000000"), /doesn't match/);
    const step = currentStep();
    await enableTotp(s.mspId, s.userId, codeAt(secret, step));

    const first = await signIn("tf@tf.example", "long enough password");
    assert.equal(first.kind, "mfa");
    const pending = first.kind === "mfa" ? first.pending : "";
    // The code used to turn it on can't be used again.
    assert.equal((await finishMfa(pending, codeAt(secret, step))).kind, "wrong");
    assert.equal((await finishMfa("forged.value", codeAt(secret, step + 1))).kind, "wrong");
    // Two sign-ins racing with the same code: only one gets in.
    const raced = await Promise.all([finishMfa(pending, codeAt(secret, step + 1)), finishMfa(pending, codeAt(secret, step + 1))]);
    assert.deepEqual(raced.map((r) => r.kind).sort(), ["session", "wrong"]);
    assert.equal((await getTeam(s.mspId)).members[0].mfa, true);
  });

  test("repeated wrong passwords are rate limited", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await signIn("limit@a.example", "nope")).kind, "wrong");
    assert.equal((await signIn("limit@a.example", "nope")).kind, "limited");
  });

  test("teammates join with a one-time invite link", async () => {
    const owner = await signUp({ name: "Owner", mspName: "Team IT", email: "owner@team.example", password: "long enough password" });
    const s = (await checkSession(owner))!;
    const invite = await createInvite(s.mspId, s.userId, "Tech@Team.example");
    assert.equal((await checkInvite(invite))?.email, "tech@team.example");
    await assert.rejects(createInvite(s.mspId, s.userId, "admin@a.example"), /already has a Zinloop account/);
    await assert.rejects(acceptInvite(invite, "Tech", "short"), /12 characters/);

    const techToken = await acceptInvite(invite, "Tech Person", "another long password");
    const tech = (await checkSession(techToken))!;
    assert.equal(tech.mspId, s.mspId);
    await assert.rejects(acceptInvite(invite, "Again", "another long password"), /expired or was already used/);
    assert.equal(await checkInvite(invite), null);

    // Another MSP can't use or see this team.
    assert.ok(!(await getTeam(a.mspId)).members.some((m) => m.email === "tech@team.example"));

    await assert.rejects(removeMember(s.mspId, tech.userId, s.userId), /owner can't be removed/);
    await removeMember(s.mspId, s.userId, tech.userId);
    assert.equal(await checkSession(techToken), null, "removed member is signed out");
  });

  test("changing the password signs out other sessions", async () => {
    const t1 = await signUp({ name: "P", mspName: "PW IT", email: "pw@pw.example", password: "long enough password" });
    const s = (await checkSession(t1))!;
    const r = await signIn("pw@pw.example", "long enough password");
    const t2 = r.kind === "session" ? r.token : "";
    await assert.rejects(changePassword(s.mspId, s.userId, "wrong", "brand new password"), /current password is wrong/);
    const t3 = await changePassword(s.mspId, s.userId, "long enough password", "brand new password");
    assert.equal(await checkSession(t1), null);
    assert.equal(await checkSession(t2), null);
    assert.ok(await checkSession(t3));
    assert.equal((await signIn("pw@pw.example", "brand new password")).kind, "session");
  });

  test("cleanup keeps each laptop's newest scan", async () => {
    const id = await createClient(a.mspId, { name: "Old Scans Co" });
    const token = await createUploadToken(a.mspId, id, "");
    await ingestScan(token, { ...sample, hostname: "OLD-1", scannedAt: "2026-01-01T00:00:00Z" });
    await ingestScan(token, { ...sample, hostname: "OLD-1", scannedAt: "2026-02-01T00:00:00Z" });
    await withTenant(a.mspId, (db) => db.query("update scans set received_at = now() - interval '200 days' where client_id = $1", [id]));
    const n = await cleanup(ownerUrl, 90);
    assert.equal(n.scans, 1);
    const left = await withTenant(a.mspId, (db) => db.query<{ scanned_at: Date }>("select scanned_at from scans where client_id = $1", [id]));
    assert.deepEqual(left.rows.map((r) => r.scanned_at.toISOString()), ["2026-02-01T00:00:00.000Z"]);
  });
  test("Microsoft 365 apps show up as agents and can be revoked", async () => {
    process.env.M365_CLIENT_ID = "test-client";
    process.env.M365_CLIENT_SECRET = "test-secret";
    const g = fakeGraph();
    const id = await createClient(a.mspId, { name: "Cloud Co" });
    assert.deepEqual(await syncM365(a.mspId, id, g.fetch), { error: "Microsoft 365 isn't connected for this client." });
    await assert.rejects(connectM365(b.mspId, id, TENANT), /Unknown client/);
    await connectM365(a.mspId, id, TENANT);
    assert.deepEqual(await syncM365(a.mspId, id, g.fetch), { apps: 3 });

    const got = (await getClient(a.mspId, id))!;
    assert.equal(got.m365?.tenantId, TENANT);
    const m365 = got.client.agents.filter((x) => x.source === "Microsoft 365");
    assert.equal(m365.length, 3);
    assert.ok((await listClients(a.mspId)).find((c) => c.id === id)!.agents.length === 3);
    assert.equal(await getClient(b.mspId, id), undefined);

    const notes = m365.find((x) => x.name === "Meeting Notes Bot")!;
    await assert.rejects(revokeM365App(b.mspId, id, notes.id, g.fetch), /isn't in this client/);
    await revokeM365App(a.mspId, id, notes.id, g.fetch);
    const after = (await getClient(a.mspId, id))!.client.agents.map((x) => x.name).sort();
    assert.deepEqual(after, ["ChatGPT", "InboxPilot AI"]);

    // A tenant that removed consent leaves a readable error on the client.
    await connectM365(a.mspId, id, "99999999-2222-3333-4444-555555555555");
    const r = await syncM365(a.mspId, id, g.fetch);
    assert.ok("error" in r && /Application not found/.test(r.error));
    assert.match((await getClient(a.mspId, id))!.m365!.lastError!, /Application not found/);
  });
});
