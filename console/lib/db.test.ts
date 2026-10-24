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
import { checkSession, signIn, signOut } from "./auth.ts";
import { createClient, createUploadToken, getClient, ingestScan, listClients, revokeUploadToken, UploadError } from "./store.ts";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const sample = JSON.parse(readFileSync(fileURLToPath(new URL("../public/sample-scan.json", import.meta.url)), "utf8"));

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

describe("database", { skip: !adminUrl && "set TEST_DATABASE_ADMIN_URL to run" }, () => {
  const dbName = `agentguard_test_${randomBytes(4).toString("hex")}`;
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
      if not exists (select from pg_roles where rolname = 'agentguard_test_owner') then
        create role agentguard_test_owner login createrole;
      end if; end $$`);
    await admin.query(`alter role agentguard_test_owner password '${appPassword}'`);
    await admin.query(`create database ${dbName} owner agentguard_test_owner`);
    const owner = new URL(withDb(adminUrl!, dbName));
    owner.username = "agentguard_test_owner";
    owner.password = appPassword;
    ownerUrl = owner.toString();
    await migrate(ownerUrl, () => {});
    await admin.query(`alter role agentguard_app login password '${appPassword}'`);
    await admin.end();
    const app = new URL(ownerUrl);
    app.username = "agentguard_app";
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
    assert.equal(await signIn("admin@a.example", "wrong"), null);
    assert.equal(await signIn("nobody@a.example", "correct horse battery"), null);
    const token = await signIn("ADMIN@a.example", "correct horse battery");
    assert.ok(token);
    const s = await checkSession(token!);
    assert.equal(s?.mspId, a.mspId);
    assert.equal(s?.mspName, "MSP A");
    await signOut(s!, token!);
    assert.equal(await checkSession(token!), null);
    assert.equal(await checkSession("ags_made-up"), null);
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

  test("bad tokens and bad reports are refused", async () => {
    const id = await createClient(a.mspId, { name: "Refuse Co" });
    const token = await createUploadToken(a.mspId, id, "");
    await assert.rejects(ingestScan(undefined, sample), (e: UploadError) => e.status === 401);
    await assert.rejects(ingestScan("agu_nope", sample), (e: UploadError) => e.status === 401);
    await assert.rejects(ingestScan(token, { hello: "world" }), (e: UploadError) => e.status === 400);
    await assert.rejects(ingestScan(token, { ...sample, hostname: "" }), (e: UploadError) => e.status === 400);

    const got = await getClient(a.mspId, id);
    await revokeUploadToken(a.mspId, got!.tokens[0].id);
    await assert.rejects(ingestScan(token, sample), (e: UploadError) => e.status === 401);
  });
});
