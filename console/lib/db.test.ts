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
import { checkSession, endOtherSessions, finishMfa, listSessions, signIn, signOut } from "./auth.ts";
import { listAudit } from "./audit.ts";
import {
  acceptInvite,
  changePassword,
  checkInvite,
  createClientViewerInvite,
  createInvite,
  disableTotp,
  enableTotp,
  getTeam,
  listClientViewers,
  removeClientViewer,
  removeMember,
  getEmailPrefs,
  setEmailPrefs,
  unsubscribe,
  setRequireMfa,
  signUp,
  startTotp,
} from "./accounts.ts";
import { codeAt, currentStep } from "./totp.ts";
import { cleanup } from "../scripts/cleanup.ts";
import { setPlan } from "../scripts/set-plan.ts";
import { snapshotAll } from "../scripts/snapshot.ts";
import { queueAllWeekly } from "../scripts/weekly.ts";
import { recordRun } from "../scripts/job-runs.ts";
import { checkHealth } from "./health.ts";
import { getMicrosoftLink, linkMicrosoft, signInWithGoogle, signInWithMicrosoft, signUpWithGoogle, unlinkMicrosoft } from "./identities.ts";
import { sendPending, type Mail } from "../scripts/send-mail.ts";
import { checkAlerts, unsubscribeUrl } from "./alerts.ts";
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
import { getPolicy, setPolicy } from "./policies.ts";
import {
  approveRemediation, cancelRemediation, listRemediations, markApplied, markFailed,
  proposeRemediation, rejectRemediation,
} from "./remediation.ts";
import { listSchedules, nextRunAt, removeSchedule, setSchedule } from "./schedules.ts";
import { fireDueSchedules } from "../scripts/schedules.ts";
import {
  createPsaIntegration, getPsaIntegration, listPsaIntegrations, openTicketForFinding, removePsaIntegration,
} from "./psa.ts";
import {
  createRmmIntegration, getRmmIntegration, listDeviceLinks, listRmmIntegrations, removeRmmIntegration, syncClientDevices,
} from "./rmm.ts";

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
    // Days before the first snapshot are left out, not shown as zero.
    assert.deepEqual((await getTrend(a.mspId, 7, new Date("2026-10-24T12:00:00Z"), id)).map((p) => p.day)[0], "2026-10-20");
    // Another MSP sees none of it.
    assert.deepEqual(await getTrend(b.mspId, 5, new Date("2026-10-24T12:00:00Z")), []);

    // The daily job writes a point for every client, even without new scans.
    const n = await snapshotAll(ownerUrl, new Date("2026-10-25T01:00:00Z"));
    assert.ok(n >= 1);
    const after = await getTrend(a.mspId, 1, new Date("2026-10-25T12:00:00Z"), id);
    assert.equal(after[0].day, "2026-10-25");

    // It also trims old points, running as a non-superuser owner.
    await snapshotAll(ownerUrl, new Date("2026-10-25T01:00:00Z"), 2);
    const kept = await withTenant(a.mspId, async (db) => (await db.query<{ day: string }>("select day::text from risk_snapshots where client_id = $1 order by day", [id])).rows.map((r) => r.day));
    assert.ok(kept.length > 0 && kept.every((d) => d >= "2026-10-23"), `older points removed: ${kept.join(", ")}`);
    assert.ok(kept.includes("2026-10-25"));
  });

  test("each scan writes a diff row so the UI can show what changed", async () => {
    const id = await createClient(a.mspId, { name: "Diff Co", devicesExpected: 1 });
    const token = await createUploadToken(a.mspId, id, "");
    // First scan: baseline, no changes.
    await ingestScan(
      token,
      { ...sample, hostname: "DIFF-1", servers: [{ name: "a", app: "Cursor", findings: [] }], configs: [], scannedAt: "2026-10-20T08:00:00Z" },
      new Date("2026-10-20T09:00:00Z"),
    );
    // Second scan: a new high-risk server appears.
    await ingestScan(
      token,
      {
        ...sample,
        hostname: "DIFF-1",
        servers: [
          { name: "a", app: "Cursor", findings: [] },
          { name: "b", app: "Claude Desktop", findings: [{ ruleId: "SHELL_ACCESS", severity: "high", title: "shell", detail: "", fix: "" }] },
        ],
        configs: [],
        scannedAt: "2026-10-21T08:00:00Z",
      },
      new Date("2026-10-21T09:00:00Z"),
    );
    const rows = await withTenant(a.mspId, async (db) =>
      (
        await db.query<{ added: number; removed: number; changed: number; risk_up: number }>(
          "select added, removed, changed, risk_up from scan_changes where client_id = $1 order by at",
          [id],
        )
      ).rows,
    );
    assert.equal(rows.length, 2, "one diff row per scan, including the baseline");
    assert.deepEqual({ added: rows[0].added, removed: rows[0].removed, changed: rows[0].changed }, { added: 0, removed: 0, changed: 0 });
    assert.equal(rows[1].added, 1);
    assert.equal(rows[1].risk_up, 0);
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

    // Members can't manage the team.
    await assert.rejects(removeMember(s.mspId, tech.userId, s.userId), /Only the account owner/);
    await assert.rejects(createInvite(s.mspId, tech.userId, "x@team.example"), /Only the account owner/);
    assert.equal(tech.role, "member");
    await removeMember(s.mspId, s.userId, tech.userId);
    assert.equal(await checkSession(techToken), null, "removed member is signed out");

    // Each step is in the audit log, and only this MSP can read it.
    const log = await listAudit(s.mspId);
    assert.deepEqual(
      log.map((e) => e.action).reverse(),
      ["signed_up", "invite_created", "member_joined", "member_removed"],
    );
    assert.equal(log[0].target, "tech@team.example");
    assert.equal(log[0].actorEmail, "owner@team.example");
    assert.ok(!(await listAudit(a.mspId)).some((e) => e.target === "tech@team.example"));
    // The app role can add entries but never change or delete them.
    await assert.rejects(withTenant(s.mspId, (db) => db.query("delete from audit_log")), /permission denied/);
    await assert.rejects(withTenant(s.mspId, (db) => db.query("update audit_log set action = 'signed_in'")), /permission denied/);
  });

  test("the audit log lists newest first even when ids gain a digit", async () => {
    const msp = await createMsp(ownerUrl, "Order IT", "admin@order.example");
    const add = () =>
      withTenant(msp.mspId, async (db) => (await db.query<{ id: string }>("insert into audit_log (msp_id, action) values ($1, 'signed_in') returning id::text", [msp.mspId])).rows[0].id);
    const first = await add();
    let last = first;
    while (last.length === first.length) last = await add();
    const ids = (await listAudit(msp.mspId, { limit: 5000 })).map((e) => BigInt(e.id));
    assert.equal(ids[0], BigInt(last));
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] > ids[i], "sorted by number, not text");
  });

  test("client viewers see only their own client and can't change anything", async () => {
    const ownerToken = await signUp({ name: "Owner", mspName: "Viewer IT", email: "owner@viewer.example", password: "long enough password" });
    const s = (await checkSession(ownerToken))!;
    await setPlan(ownerUrl, "owner@viewer.example", "partner");
    const mine = await createClient(s.mspId, { name: "Mine Co" });
    const other = await createClient(s.mspId, { name: "Other Co" });
    for (const id of [mine, other]) await ingestScan(await createUploadToken(s.mspId, id, ""), sample);

    // Only the owner can give out logins, and only for a client of their own.
    const memberToken = await acceptInvite(await createInvite(s.mspId, s.userId, "tech@viewer.example"), "Tech", "another long password");
    const member = (await checkSession(memberToken))!;
    await assert.rejects(createClientViewerInvite(s.mspId, member.userId, mine, "boss@mine.example"), /Only the account owner/);
    const bClient = await createClient(b.mspId, { name: "B's client" });
    await assert.rejects(createClientViewerInvite(s.mspId, s.userId, bClient, "boss@mine.example"), /wasn't found/);

    const link = await createClientViewerInvite(s.mspId, s.userId, mine, "Boss@Mine.example");
    const inv = (await checkInvite(link))!;
    assert.equal(inv.role, "viewer");
    assert.equal(inv.clientName, "Mine Co");
    const viewerToken = await acceptInvite(link, "Boss", "a long viewer password");
    const v = (await checkSession(viewerToken))!;
    assert.equal(v.role, "viewer");
    assert.equal(v.clientId, mine);
    assert.equal(v.clientName, "Mine Co");
    assert.ok(!(await getTeam(s.mspId)).members.some((m) => m.email === "boss@mine.example"), "viewers aren't teammates");

    // The previous console version's session lookup never lets a viewer in.
    const oldLookup = (token: string) =>
      withTenant(s.mspId, async (db) => (await db.query("select * from auth_check_session($1)", [tokenHash(token)])).rows);
    assert.equal((await oldLookup(memberToken)).length, 1);
    assert.equal((await oldLookup(viewerToken)).length, 0);
    // Nor can its invite page turn a pending client-viewer invite into a team member.
    await createClientViewerInvite(s.mspId, s.userId, mine, "next@mine.example");
    await assert.rejects(
      withTenant(s.mspId, (db) =>
        db.query("insert into users (msp_id, email, password_hash, name, role) values ($1, 'next@mine.example', 'x', 'Next', 'member')", [s.mspId]),
      ),
      /client login, not the team/,
    );
    // The old page marks the invite accepted first, then adds the user, in one transaction.
    await assert.rejects(
      withTenant(s.mspId, async (db) => {
        await db.query("update invites set accepted_at = now() where msp_id = $1 and email = 'next@mine.example' and accepted_at is null", [s.mspId]);
        await db.query("insert into users (msp_id, email, password_hash, name, role) values ($1, 'next@mine.example', 'x', 'Next', 'member')", [s.mspId]);
      }),
      /client login, not the team/,
    );
    // The old lookup keeps an active session alive, like the current one does.
    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      await owner.query("update sessions set last_seen_at = now() - interval '3 hours' where token_hash = $1", [tokenHash(memberToken)]);
      assert.equal((await oldLookup(memberToken)).length, 1);
      const seen = await owner.query<{ fresh: boolean }>(
        "select last_seen_at > now() - interval '1 minute' as fresh from sessions where token_hash = $1",
        [tokenHash(memberToken)],
      );
      assert.equal(seen.rows[0].fresh, true);
    } finally {
      await owner.end();
    }
    assert.deepEqual((await listClientViewers(s.mspId, mine)).viewers.map((x) => x.email), ["boss@mine.example"]);
    assert.equal((await listClientViewers(s.mspId, other)).viewers.length, 0);

    // Scoped to their client, the database shows nothing else.
    const scope = { mspId: v.mspId, clientId: v.clientId };
    const rows = (sql: string) => withTenant(scope, async (db) => (await db.query(sql)).rows);
    assert.ok((await getClient(scope, mine))!.client.agents.length > 0);
    assert.equal(await getClient(scope, other), undefined);
    assert.deepEqual((await rows("select id from clients")).map((r) => r.id), [mine]);
    assert.ok((await rows("select client_id from scans")).every((r) => r.client_id === mine));
    assert.ok((await rows("select client_id from devices")).every((r) => r.client_id === mine));
    assert.equal((await rows("select id from upload_tokens")).length, 0);
    assert.equal((await rows("select id from invites")).length, 0);
    assert.equal((await rows("select id from audit_log")).length, 0);
    assert.deepEqual((await rows("select email from users")).map((r) => r.email), ["boss@mine.example"]);
    const scopedTrend = await getTrend(scope, 1, new Date(), mine);
    assert.deepEqual(scopedTrend, await getTrend(s.mspId, 1, new Date(), mine));
    assert.deepEqual(await getTrend(scope, 1, new Date(), other), [], "asking for another client's trend gets nothing");

    // And it refuses changes to client data.
    await assert.rejects(withTenant(scope, (db) => db.query("insert into clients (msp_id, name) values ($1, 'New')", [s.mspId])), /row-level security/);
    await assert.rejects(withTenant(scope, (db) => db.query("update clients set name = 'Renamed'")), /row-level security/);
    await assert.rejects(withTenant(scope, (db) => db.query("insert into upload_tokens (msp_id, client_id, token_hash) values ($1, $2, '\\x00')", [s.mspId, mine])), /row-level security/);
    assert.equal((await withTenant(scope, (db) => db.query("delete from scans"))).rowCount, 0);
    assert.equal((await withTenant(scope, (db) => db.query("delete from clients"))).rowCount, 0);
    assert.equal((await withTenant(scope, (db) => db.query("update msps set require_mfa = false"))).rowCount, 0);
    await assert.rejects(withTenant(scope, (db) => db.query("update users set client_id = $1", [other])), /row-level security/);
    assert.equal((await getClient(s.mspId, mine))!.client.name, "Mine Co");

    // Removing the login signs them out; a member can't, and the team page can't remove viewers.
    await assert.rejects(removeClientViewer(s.mspId, member.userId, mine, v.userId), /Only the account owner/);
    await assert.rejects(removeMember(s.mspId, s.userId, v.userId));
    await assert.rejects(removeClientViewer(s.mspId, s.userId, other, v.userId), /wasn't found/);
    await removeClientViewer(s.mspId, s.userId, mine, v.userId);
    assert.equal(await checkSession(viewerToken), null);
    const actions = (await listAudit(s.mspId)).map((e) => e.action);
    for (const a of ["client_login_created", "client_viewer_joined", "client_login_removed"]) assert.ok(actions.includes(a as never), a);
  });

  test("new high-risk tools are emailed once, and the weekly summary goes to everyone who wants it", async () => {
    process.env.CONSOLE_URL = "https://app.example";
    const ownerToken = await signUp({ name: "Owner", mspName: "Mail IT", email: "owner@mail.example", password: "long enough password" });
    const s = (await checkSession(ownerToken))!;
    await setPlan(ownerUrl, "owner@mail.example", "partner");
    const quiet = (await checkSession(await acceptInvite(await createInvite(s.mspId, s.userId, "quiet@mail.example"), "Quiet", "another long password")))!;
    await setEmailPrefs(s.mspId, quiet.userId, { alerts: false, weekly: false });
    assert.deepEqual(await getEmailPrefs(s.mspId, quiet.userId), { alerts: false, weekly: false });
    const clientId = await createClient(s.mspId, { name: "Mail Co" });
    const viewer = (await checkSession(await acceptInvite(await createClientViewerInvite(s.mspId, s.userId, clientId, "boss@mailco.example"), "Boss", "a long viewer password")))!;
    const outbox = () =>
      withTenant(s.mspId, async (db) => (await db.query<{ kind: string; to_email: string; subject: string; body_text: string; unsubscribe_url: string }>("select kind, to_email, subject, body_text, unsubscribe_url from outbox order by id")).rows);

    const token = await createUploadToken(s.mspId, clientId, "");
    await ingestScan(token, sample);
    let mail = await outbox();
    assert.deepEqual(mail.map((m) => [m.kind, m.to_email]), [["alert", "owner@mail.example"]], "only the team member with alerts on; never viewers");
    assert.match(mail[0].subject, /new high-risk AI tool problems at Mail Co/);
    assert.match(mail[0].body_text, /https:\/\/app\.example\/app\/clients\//);
    assert.ok(mail[0].unsubscribe_url.startsWith("https://app.example/unsubscribe?t="));

    // The same findings again: no new email. Checking twice at once: still one.
    await ingestScan(token, sample);
    await Promise.all([checkAlerts(s.mspId, clientId), checkAlerts(s.mspId, clientId)]);
    assert.equal((await outbox()).length, 1);
    // Viewers can't read the outbox.
    assert.equal((await withTenant({ mspId: s.mspId, clientId }, (db) => db.query("select * from outbox"))).rowCount, 0);

    // Weekly: one per person per week, whatever day it runs.
    const monday = new Date();
    const queued = await queueAllWeekly(ownerUrl, monday);
    assert.ok(queued >= 2);
    assert.equal(await queueAllWeekly(ownerUrl, monday), 0, "running again the same week queues nothing");
    mail = (await outbox()).filter((m) => m.kind === "weekly");
    assert.deepEqual(mail.map((m) => m.to_email).sort(), ["boss@mailco.example", "owner@mail.example"]);
    assert.match(mail.find((m) => m.to_email === "owner@mail.example")!.subject, /across 1 client$/);
    const forViewer = mail.find((m) => m.to_email === "boss@mailco.example")!;
    assert.match(forViewer.subject, /^Mail Co: weekly AI security summary/);
    assert.ok(!forViewer.body_text.includes("Other"), "the viewer's summary is only about their client");

    // Sending: failures are retried later, successes are marked sent.
    const sent: Mail[] = [];
    const failing = { sendMail: async () => { throw new Error("SMTP down"); } };
    const r1 = await sendPending(ownerUrl, failing, "Zinloop <alerts@zinloop.example>");
    assert.equal(r1.sent, 0);
    assert.ok(r1.failed >= 3);
    const ok = { sendMail: async (m: Mail) => { sent.push(m); } };
    assert.equal((await sendPending(ownerUrl, ok, "Zinloop <alerts@zinloop.example>")).sent, 0, "failed emails wait before the next try");
    const admin = new pg.Client({ connectionString: ownerUrl });
    await admin.connect();
    await admin.query("update outbox set next_try_at = now()");
    const pending = Number((await admin.query("select count(*) from outbox where sent_at is null")).rows[0].count);
    const r2 = await sendPending(ownerUrl, ok, "Zinloop <alerts@zinloop.example>");
    assert.equal(r2.sent, pending);
    assert.equal(Number((await admin.query("select count(*) from outbox where sent_at is null")).rows[0].count), 0);
    await admin.end();
    const alert = sent.find((m) => m.subject.includes("Mail Co") && m.to === "owner@mail.example" && !m.subject.startsWith("Weekly"))!;
    assert.match(alert.headers!["List-Unsubscribe"], /^<https:\/\/app\.example\/api\/unsubscribe\?t=/);
    assert.equal(alert.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

    // Removing someone drops their unsent mail.
    const gone = (await checkSession(await acceptInvite(await createInvite(s.mspId, s.userId, "leaver@mail.example"), "Leaver", "another long password")))!;
    await withTenant(s.mspId, (db) =>
      db.query("insert into outbox (msp_id, dedupe_key, kind, user_id, to_email, subject, body_text, body_html) values ($1, 'test:leaver', 'weekly', $2, 'leaver@mail.example', 's', 't', 'h')", [s.mspId, gone.userId]),
    );
    await removeMember(s.mspId, s.userId, gone.userId);
    assert.ok(!(await outbox()).some((m) => m.to_email === "leaver@mail.example"));

    // Unsubscribe turns off one kind of email for that person only.
    assert.equal(await unsubscribe(viewer.userId, "weekly"), "boss@mailco.example");
    assert.deepEqual(await getEmailPrefs(s.mspId, viewer.userId), { alerts: true, weekly: false });
    assert.equal((await getEmailPrefs(s.mspId, s.userId)).weekly, true);
    assert.ok(unsubscribeUrl(s.userId, "alert"));

    // Mail queued before someone turned it off isn't sent.
    await withTenant(s.mspId, (db) =>
      db.query(
        `insert into outbox (msp_id, dedupe_key, kind, user_id, to_email, subject, body_text, body_html)
         values ($1, 'test:off', 'weekly', $2, 'boss@mailco.example', 'late weekly', 't', 'h'), ($1, 'test:on', 'alert', $2, 'boss@mailco.example', 'still wanted', 't', 'h')`,
        [s.mspId, viewer.userId],
      ),
    );
    sent.length = 0;
    assert.equal((await sendPending(ownerUrl, ok, "Zinloop <alerts@zinloop.example>")).sent, 1);
    assert.deepEqual(sent.map((m) => m.subject), ["still wanted"]);
    assert.ok(!(await outbox()).some((m) => m.subject === "late weekly"), "dropped, not just skipped");
    delete process.env.CONSOLE_URL;
  });

  test("the health check sees the database and background job results", async () => {
    assert.deepEqual(await checkHealth(false), { ok: true, database: "ok" });
    await recordRun(ownerUrl, "backup");
    await recordRun(ownerUrl, "snapshot");
    assert.deepEqual((await checkHealth(true)).jobs, { backup: "ok", snapshot: "ok" });
    await recordRun(ownerUrl, "backup", new Error("disk full"));
    const h = await checkHealth(true);
    assert.equal(h.ok, false);
    assert.equal(h.jobs!.backup, "failing");
    // The app role can only read the summary, not the table or error text.
    await assert.rejects(getPool().query("select * from job_runs"), /permission denied/);
    await recordRun(ownerUrl, "backup");
    assert.equal((await checkHealth(true)).ok, true);
  });

  test("a linked Microsoft account signs in; an unlinked or reused one doesn't", async () => {
    const tok = await signUp({ name: "Owner", mspName: "SSO IT", email: "owner@sso.example", password: "long enough password" });
    const s = (await checkSession(tok))!;
    const dana = { tenantId: "11111111-2222-3333-4444-555555555555", objectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "dana@contoso.example", name: "Dana" };
    assert.deepEqual(await signInWithMicrosoft(dana), { kind: "not-linked" });
    await linkMicrosoft(s, dana);
    assert.equal((await getMicrosoftLink(s))?.label, "dana@contoso.example");
    const r = await signInWithMicrosoft(dana, { ip: "203.0.113.9" });
    assert.equal(r.kind, "session");
    assert.equal((await checkSession((r as { token: string }).token))?.userId, s.userId);
    // Same object ID in a different tenant is a different person.
    assert.deepEqual(await signInWithMicrosoft({ ...dana, tenantId: "99999999-2222-3333-4444-555555555555" }), { kind: "not-linked" });
    // One Microsoft account can't be linked to two Zinloop logins, even across MSPs.
    const other = (await checkSession(await signUp({ name: "B", mspName: "Other IT", email: "b@other.example", password: "long enough password" })))!;
    await assert.rejects(linkMicrosoft(other, dana), /already linked/);
    // With two-factor on, Microsoft sign-in still asks for the code.
    const secret = await startTotp(s.mspId, s.userId);
    await enableTotp(s.mspId, s.userId, codeAt(secret, currentStep()));
    assert.equal((await signInWithMicrosoft(dana)).kind, "mfa");
    await unlinkMicrosoft(s);
    assert.equal(await getMicrosoftLink(s), null);
    assert.deepEqual(await signInWithMicrosoft(dana), { kind: "not-linked" });
    const actions = (await listAudit(s.mspId)).map((e) => e.action);
    for (const a of ["microsoft_linked", "microsoft_unlinked", "signed_in"]) assert.ok(actions.includes(a as never), a);
    assert.ok((await listAudit(s.mspId)).some((e) => e.action === "signed_in" && e.detail.method === "microsoft"));
  });

  test("signing up with Google creates a classified, password-less account and never adopts an existing email", async () => {
    // An organization mailbox becomes an organization account named from the domain.
    const acme = { sub: "100000000000000000001", label: "Ada@Acme-Corp.example", name: "Ada Lovelace" };
    const r = await signUpWithGoogle(acme, { ip: "203.0.113.20" });
    assert.equal(r.kind, "session");
    const s = (await checkSession((r as { token: string }).token))!;
    assert.equal(s.role, "owner");
    assert.equal(s.email, "ada@acme-corp.example"); // stored lowercased so password sign-in can find it
    assert.equal(s.mspName, "Acme Corp");
    assert.equal((await getTeam(s.mspId)).accountType, "organization");
    // The Google account can sign the owner back in.
    assert.equal((await signInWithGoogle(acme)).kind, "session");
    // No password was set: a password sign-in fails cleanly rather than erroring.
    assert.equal((await signIn("ada@acme-corp.example", "not the password here")).kind, "wrong");
    // Clicking "Sign up with Google" again signs the same owner in, not a second account.
    const again = await signUpWithGoogle(acme, { ip: "203.0.113.20" });
    assert.equal((await checkSession((again as { token: string }).token))?.userId, s.userId);

    // A consumer mailbox becomes an individual account named after the person.
    const g = await signUpWithGoogle({ sub: "100000000000000000002", label: "sam@gmail.com", name: "Sam Rivera" });
    const gs = (await checkSession((g as { token: string }).token))!;
    assert.equal((await getTeam(gs.mspId)).accountType, "individual");
    assert.equal(gs.mspName, "Sam Rivera");

    // An address that already has a password account is never taken over by Google.
    await signUp({ name: "Existing", mspName: "Existing IT", email: "owner@existing.example", password: "long enough password" });
    assert.deepEqual(await signUpWithGoogle({ sub: "100000000000000000003", label: "owner@existing.example", name: "Imposter" }), { kind: "exists" });

    const actions = (await listAudit(s.mspId)).map((e) => e.action);
    for (const a of ["signed_up", "google_linked", "signed_in"]) assert.ok(actions.includes(a as never), a);
    assert.ok((await listAudit(s.mspId)).some((e) => e.action === "signed_up" && e.detail.method === "google"));
  });

  test("owners can require two-factor sign-in for the whole team", async () => {
    const t = await signUp({ name: "Req", mspName: "Req IT", email: "req@req.example", password: "long enough password" });
    const s = (await checkSession(t))!;
    assert.equal(s.requireMfa, false);
    await assert.rejects(setRequireMfa(s.mspId, s.userId, true), /your own account first/);
    const secret = await startTotp(s.mspId, s.userId);
    await enableTotp(s.mspId, s.userId, codeAt(secret, currentStep()));
    await setRequireMfa(s.mspId, s.userId, true);
    const after = (await checkSession(t))!;
    assert.equal(after.requireMfa, true);
    assert.equal(after.mfa, true);
    await assert.rejects(disableTotp(s.mspId, s.userId, "long enough password"), /requires two-factor/);
    const log = await listAudit(s.mspId, { action: "require_mfa_changed" });
    assert.equal(log[0].detail.required, true);
  });

  test("sessions are listed, can be ended elsewhere, and end after being idle", async () => {
    const t1 = await signUp({ name: "Ses", mspName: "Ses IT", email: "ses@ses.example", password: "long enough password" });
    const r = await signIn("ses@ses.example", "long enough password", "203.0.113.9", "Mozilla/5.0 (Windows NT 10.0) Chrome/130");
    const t2 = r.kind === "session" ? r.token : "";
    const s1 = (await checkSession(t1))!;
    const list = await listSessions(s1);
    assert.equal(list.length, 2);
    assert.equal(list.filter((x) => x.current).length, 1);
    assert.ok(list.some((x) => x.ip === "203.0.113.9" && x.userAgent.includes("Chrome")));
    assert.equal(await endOtherSessions(s1), 1);
    assert.equal(await checkSession(t2), null);
    assert.ok(await checkSession(t1));

    // A session unused for longer than the idle limit stops working.
    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      await owner.query("update sessions set last_seen_at = now() - interval '10 hours' where id = $1", [s1.sessionId]);
    } finally {
      await owner.end();
    }
    assert.equal(await checkSession(t1), null);
    const failed = await signIn("ses@ses.example", "wrong password");
    assert.equal(failed.kind, "wrong");
    assert.equal((await listAudit(s1.mspId, { action: "sign_in_failed" })).length, 1);
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

    // Reconnecting the same tenant keeps its apps until the next sync.
    await connectM365(a.mspId, id, TENANT);
    assert.equal((await getClient(a.mspId, id))!.client.agents.length, 2);

    // A different tenant starts empty, without the old tenant's apps or sync time.
    await connectM365(a.mspId, id, "99999999-2222-3333-4444-555555555555");
    const switched = (await getClient(a.mspId, id))!;
    assert.equal(switched.client.agents.length, 0);
    assert.equal(switched.m365?.lastSync ?? null, null);

    // A tenant that removed consent leaves a readable error on the client.
    const r = await syncM365(a.mspId, id, g.fetch);
    assert.ok("error" in r && /Application not found/.test(r.error));
    assert.match((await getClient(a.mspId, id))!.m365!.lastError!, /Application not found/);
  });

  test("per-client policies default sensibly, are tenant-isolated, and reject bad input", async () => {
    const mine = await createClient(a.mspId, { name: "Policy Co" });
    const theirs = await createClient(b.mspId, { name: "Theirs" });
    const def = await getPolicy(a.mspId, mine);
    assert.equal(def.autoApplyApproved, true);
    assert.equal(def.ticketThreshold, "high");
    assert.deepEqual(def.allowedPublishers, []);

    const saved = await setPolicy(a.mspId, mine, {
      ticketThreshold: "medium",
      autoApplyApproved: false,
      blockedPublishers: ["Evil.AI", "evil.ai", "x"],
      reportRecipients: ["sales@customer.example", "duplicate@x.example", "duplicate@x.example"],
    });
    assert.equal(saved.ticketThreshold, "medium");
    assert.deepEqual(saved.blockedPublishers, ["evil.ai", "x"]);
    assert.equal(saved.reportRecipients.length, 2);
    assert.equal(saved.autoApplyApproved, false);

    // Merge semantics: a later update that only changes threshold keeps the lists.
    const merged = await setPolicy(a.mspId, mine, { ticketThreshold: "low" });
    assert.deepEqual(merged.blockedPublishers, ["evil.ai", "x"]);
    assert.equal(merged.ticketThreshold, "low");

    // Another MSP's row is invisible and refuses writes.
    await assert.rejects(setPolicy(a.mspId, theirs, { ticketThreshold: "high" }), /wasn't found/);
    const theirsPolicy = await getPolicy(b.mspId, theirs);
    assert.equal(theirsPolicy.ticketThreshold, "high");
  });

  test("remediations: technician proposes, owner approves, apply + reject + cancel transitions", async () => {
    const mine = await createClient(a.mspId, { name: "Fix Co" });
    const ownerSession = (await checkSession(await signIn("admin@a.example", "correct horse battery").then((r) => r.kind === "session" ? r.token : "")))!;

    // Add a technician.
    const techLink = await createInvite(a.mspId, ownerSession.userId, "tech+r@a.example", null, "technician");
    const techToken = await acceptInvite(techLink, "Tech", "another long password");
    const tech = (await checkSession(techToken))!;
    assert.equal(tech.role, "technician");

    // Policy with auto-apply off, so a propose stays pending.
    await setPolicy(a.mspId, mine, { autoApplyApproved: false });

    const r = await proposeRemediation(tech, {
      clientId: mine, action: "revoke_m365_app",
      payload: { agentId: "m365-x", appName: "Risky AI" },
      summary: "Revoke Risky AI from Fix Co",
      findingKey: "M365_ORG_WIDE_GRANT|m365-x",
    });
    assert.equal(r.status, "pending");
    assert.equal(r.requestedByEmail, "tech+r@a.example");

    // Technician can't approve or apply.
    await assert.rejects(approveRemediation(tech, r.id), /owner or member/);
    await assert.rejects(markApplied(a.mspId, r.id, { userId: tech.userId, email: tech.email }), /isn't approved/);

    // A duplicate pending remediation is refused.
    await assert.rejects(proposeRemediation(tech, { clientId: mine, action: "revoke_m365_app", payload: {}, summary: "dup", findingKey: "M365_ORG_WIDE_GRANT|m365-x" }), /already exists/);

    // Owner approves.
    const approved = await approveRemediation(ownerSession, r.id);
    assert.equal(approved.status, "approved");
    assert.equal(approved.decidedByEmail, "admin@a.example");

    // Approved can be applied; applied is terminal.
    const applied = await markApplied(a.mspId, r.id, { userId: ownerSession.userId, email: ownerSession.email });
    assert.equal(applied.status, "applied");
    await assert.rejects(markApplied(a.mspId, r.id, { userId: ownerSession.userId, email: ownerSession.email }), /isn't approved/);

    // Reject path.
    const r2 = await proposeRemediation(tech, { clientId: mine, action: "rotate_secret", payload: {}, summary: "Rotate", findingKey: "SECRET_IN_CONFIG|k" });
    const rejected = await rejectRemediation(ownerSession, r2.id);
    assert.equal(rejected.status, "rejected");

    // Cancel path: a technician can cancel their own pending.
    const r3 = await proposeRemediation(tech, { clientId: mine, action: "custom", payload: {}, summary: "Custom", findingKey: "custom-1" });
    await assert.rejects(cancelRemediation(tech, r.id), /pending/); // not pending any more
    const cancelled = await cancelRemediation(tech, r3.id);
    assert.equal(cancelled.status, "cancelled");

    // Auto-apply policy skips 'pending'.
    await setPolicy(a.mspId, mine, { autoApplyApproved: true });
    const r4 = await proposeRemediation(ownerSession, { clientId: mine, action: "custom", payload: {}, summary: "Auto", findingKey: "custom-2" });
    assert.equal(r4.status, "approved");

    // Mark failed also logs.
    const r5 = await proposeRemediation(ownerSession, { clientId: mine, action: "custom", payload: {}, summary: "Fail", findingKey: "custom-3" });
    await markFailed(a.mspId, r5.id, "boom", { userId: ownerSession.userId, email: ownerSession.email });
    assert.equal((await listRemediations(a.mspId, { status: "failed" })).length, 1);

    // The audit log sees every transition.
    const actions = (await listAudit(a.mspId)).map((e) => e.action);
    for (const a of ["remediation_proposed", "remediation_approved", "remediation_applied",
                     "remediation_rejected", "remediation_cancelled", "remediation_failed"]) {
      assert.ok(actions.includes(a as never), a);
    }

    // Other MSP sees nothing.
    assert.deepEqual(await listRemediations(b.mspId), []);
  });

  test("report schedules: setSchedule picks next_run_at and the cron queues emails", async () => {
    process.env.CONSOLE_URL = "https://app.example";
    const owner = (await checkSession(await signUp({ name: "Sched", mspName: "Sched IT", email: "sched@sched.example", password: "long enough password" })))!;
    await setPlan(ownerUrl, "sched@sched.example", "partner");
    const client = await createClient(owner.mspId, { name: "Scheduled Co" });
    const token = await createUploadToken(owner.mspId, client, "");
    await ingestScan(token, sample);

    const now = new Date("2026-10-26T05:00:00Z"); // Monday 05:00 UTC
    const sched = await setSchedule(owner, {
      clientId: client, frequency: "weekly", dayOfPeriod: 1, hourUtc: 6,
      recipients: ["ciso@customer.example"],
    }, null, now);
    assert.equal(new Date(sched.nextRunAt).toISOString(), "2026-10-26T06:00:00.000Z");

    // Nothing fires before due.
    assert.deepEqual(await fireDueSchedules(ownerUrl, new Date("2026-10-26T05:30:00Z")), { ran: 0, queued: 0 });

    // At due time, exactly one email is queued per listed recipient.
    const r1 = await fireDueSchedules(ownerUrl, new Date("2026-10-26T06:30:00Z"));
    assert.equal(r1.ran, 1);
    assert.equal(r1.queued, 1);
    const inbox = await withTenant(owner.mspId, async (db) =>
      (await db.query<{ to_email: string; subject: string }>("select to_email, subject from outbox where to_email = 'ciso@customer.example'")).rows,
    );
    assert.equal(inbox.length, 1);
    assert.match(inbox[0].subject, /Weekly AI security report/);

    // next_run_at rolls forward.
    const after = (await listSchedules(owner.mspId))[0];
    assert.equal(new Date(after.nextRunAt).toISOString(), "2026-11-02T06:00:00.000Z");

    // Default recipients: team members with weekly_email on, plus the client policy's external contacts.
    await setPolicy(owner.mspId, client, { reportRecipients: ["board@customer.example"] });
    await setSchedule(owner, { clientId: client, frequency: "weekly", dayOfPeriod: 1, hourUtc: 6, recipients: [] }, null, now);
    const r2 = await fireDueSchedules(ownerUrl, new Date("2026-10-26T06:30:00Z"));
    assert.equal(r2.ran, 1);
    const recipients = await withTenant(owner.mspId, async (db) =>
      (await db.query<{ to_email: string }>("select distinct to_email from outbox where to_email like '%@%' order by to_email")).rows.map((r) => r.to_email),
    );
    assert.ok(recipients.includes("board@customer.example"));
    assert.ok(recipients.includes("sched@sched.example"));

    // Removal.
    const schedId = (await listSchedules(owner.mspId))[0].id;
    await removeSchedule(owner, schedId);
    assert.deepEqual(await listSchedules(owner.mspId), []);

    // Only owner/member can touch schedules.
    const techToken = await acceptInvite(await createInvite(owner.mspId, owner.userId, "tech+s@sched.example", null, "technician"), "T", "another long password");
    const tech = (await checkSession(techToken))!;
    await assert.rejects(setSchedule(tech, { clientId: client, frequency: "monthly", dayOfPeriod: 1 }), /owner or member/);

    // Smoke-check the pure helper too.
    assert.equal(nextRunAt("monthly", 15, 0, new Date("2026-10-15T01:00:00Z")).toISOString(), "2026-11-15T00:00:00.000Z");

    delete process.env.CONSOLE_URL;
  });

  test("PSA integrations: owner-only, encrypted at rest, deduped ticket per finding, test mode works offline", async () => {
    const ownerS = (await checkSession(await signIn("admin@a.example", "correct horse battery").then((r) => r.kind === "session" ? r.token : "")))!;
    const client = await createClient(a.mspId, { name: "Ticket Co" });

    // Technician can't add integrations.
    const techToken = await acceptInvite(await createInvite(a.mspId, ownerS.userId, "tech+p@a.example", null, "technician"), "T", "another long password");
    const tech = (await checkSession(techToken))!;
    await assert.rejects(createPsaIntegration(tech, { name: "x", mode: "test", config: { kind: "connectwise", site: "a.myconnectwise.net", companyId: "a", publicKey: "a", privateKey: "a", clientId: "a" } }), /account owner/);

    const integ = await createPsaIntegration(ownerS, {
      name: "ConnectWise test",
      mode: "test",
      config: { kind: "connectwise", site: "a.myconnectwise.net", companyId: "zinloop", publicKey: "pub", privateKey: "priv", clientId: "cid" },
    });
    assert.equal(integ.mode, "test");

    // Config roundtrips through decrypt.
    const back = await getPsaIntegration(a.mspId, integ.id);
    assert.equal(back?.config.kind, "connectwise");
    if (back?.config.kind === "connectwise") assert.equal(back.config.privateKey, "priv");

    // Listing shows the integration without the config body.
    const listed = await listPsaIntegrations(a.mspId);
    assert.ok(listed.some((x) => x.id === integ.id));

    // Opening a ticket in test mode works and dedupes by (client, finding_key).
    const t1 = await openTicketForFinding({
      mspId: a.mspId, clientId: client, integrationId: integ.id,
      finding: { summary: "Plain key in Claude Desktop", description: "...", companyId: "42", severity: "high", findingKey: "SECRET_IN_CONFIG|d1|claude" },
    });
    assert.equal(t1.status, "open");
    assert.match(t1.externalId, /^connectwise-/);
    const t2 = await openTicketForFinding({
      mspId: a.mspId, clientId: client, integrationId: integ.id,
      finding: { summary: "same", description: "...", companyId: "42", severity: "high", findingKey: "SECRET_IN_CONFIG|d1|claude" },
    });
    assert.equal(t1.id, t2.id); // dedupe

    // Another MSP can't use this integration.
    const otherClient = await createClient(b.mspId, { name: "Other" });
    await assert.rejects(openTicketForFinding({
      mspId: b.mspId, clientId: otherClient, integrationId: integ.id,
      finding: { summary: "x", description: "...", companyId: "9", severity: "low", findingKey: "x" },
    }), /wasn't found/);

    // Removal (owner-only).
    await assert.rejects(removePsaIntegration(tech, integ.id), /account owner/);
    await removePsaIntegration(ownerS, integ.id);
    assert.equal(await getPsaIntegration(a.mspId, integ.id), null);
    // Removing the integration deletes its tickets (ON DELETE CASCADE).
    const left = await withTenant(a.mspId, (db) => db.query("select count(*)::int as n from psa_tickets"));
    assert.equal((left.rows[0] as { n: number }).n, 0);
  });

  test("RMM integrations: owner-only, device sync links by hostname, test mode works offline", async () => {
    const ownerS = (await checkSession(await signIn("admin@a.example", "correct horse battery").then((r) => r.kind === "session" ? r.token : "")))!;
    const client = await createClient(a.mspId, { name: "RMM Co" });

    const integ = await createRmmIntegration(ownerS, {
      name: "NinjaOne test",
      mode: "test",
      config: { kind: "ninjaone", host: "us.ninjarmm.com", clientId: "cid", clientSecret: "sec" },
    });
    assert.equal(integ.mode, "test");

    const back = await getRmmIntegration(a.mspId, integ.id);
    assert.equal(back?.config.kind, "ninjaone");

    const listed = await listRmmIntegrations(a.mspId);
    assert.ok(listed.some((x) => x.id === integ.id));

    // Test mode sync adds device links; a repeat sync doesn't duplicate rows.
    const r1 = await syncClientDevices(a.mspId, client, integ.id, "org-123");
    assert.ok(r1.added >= 2);
    assert.equal(r1.added + r1.updated, r1.total);
    const r2 = await syncClientDevices(a.mspId, client, integ.id, "org-123");
    assert.equal(r2.added, 0);
    assert.equal(r2.updated, r1.total);

    // Links are visible under the tenant, invisible to the other MSP.
    const links = await listDeviceLinks(a.mspId, client);
    assert.equal(links.length, r1.total);
    assert.deepEqual(await listDeviceLinks(b.mspId, client), []);

    // Deleting the integration cascades to its links.
    await removeRmmIntegration(ownerS, integ.id);
    assert.deepEqual(await listDeviceLinks(a.mspId, client), []);
  });
});
