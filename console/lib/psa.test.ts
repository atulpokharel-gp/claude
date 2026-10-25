// Pure tests for the PSA adapter: config validation, request shape per
// vendor, test-mode mock output. The database-backed storage path is
// exercised by lib/db.test.ts under TEST_DATABASE_ADMIN_URL.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cleanConfig,
  configBaseUrl,
  openTicket,
  PsaError,
  type ConnectWiseConfig,
  type AutotaskConfig,
  type HaloPsaConfig,
  type NewTicket,
  type PsaIntegrationWithConfig,
} from "./psa.ts";

process.env.APP_SECRET ??= randomBytes(32).toString("base64");

const findingKey = "SECRET_IN_CONFIG|device-abc|claude";
const base: NewTicket = {
  summary: "Zinloop found a plain-text key",
  description: "Device: laptop-1\nFile: ~/.config/claude.json\nAction: rotate",
  companyId: "42",
  severity: "high",
  findingKey,
};

const cwCfg: ConnectWiseConfig = {
  kind: "connectwise",
  site: "example.myconnectwise.net",
  companyId: "zinloop",
  publicKey: "pub",
  privateKey: "priv",
  clientId: "client-guid",
  boardId: 7,
};

const atCfg: AutotaskConfig = {
  kind: "autotask",
  apiIntegrationCode: "ABC",
  userName: "user@zinloop.com",
  secret: "s3cret",
  zoneUrl: "https://webservices2.autotask.net/ATServicesRest/V1.0",
  queueId: 29683402,
};

const haloCfg: HaloPsaConfig = {
  kind: "halopsa",
  site: "yourmsp.halopsa.com",
  clientId: "halo-client",
  clientSecret: "halo-secret",
  ticketTypeId: 24,
  teamId: 1,
};

function integration(cfg: ConnectWiseConfig | AutotaskConfig | HaloPsaConfig, mode: "live" | "test" = "live"): PsaIntegrationWithConfig {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    mspId: "22222222-2222-2222-2222-222222222222",
    kind: cfg.kind,
    name: "Test",
    baseUrl: configBaseUrl(cfg),
    mode,
    active: true,
    lastCheckAt: null,
    lastError: "",
    createdAt: new Date().toISOString(),
    config: cfg,
  };
}

describe("psa: cleanConfig", () => {
  test("rejects unknown kinds", () => {
    assert.throws(() => cleanConfig({ kind: "jira" } as unknown), (err: unknown) => err instanceof PsaError);
  });

  test("ConnectWise requires companyId, keys and clientId", () => {
    assert.throws(() => cleanConfig({ kind: "connectwise", site: "x.myconnectwise.net" }), /companyId/);
  });

  test("ConnectWise site must be a hostname", () => {
    assert.throws(() => cleanConfig({ kind: "connectwise", site: "not a hostname", companyId: "a", publicKey: "a", privateKey: "a", clientId: "a" }), /site/);
  });

  test("Autotask zoneUrl must be https", () => {
    assert.throws(() => cleanConfig({ kind: "autotask", apiIntegrationCode: "a", userName: "a", secret: "a", zoneUrl: "http://foo" }), /https/);
  });

  test("HaloPSA needs clientId and clientSecret", () => {
    assert.throws(() => cleanConfig({ kind: "halopsa", site: "x.halopsa.com" }), /clientId/);
  });

  test("good config roundtrips", () => {
    const c = cleanConfig(cwCfg);
    assert.deepEqual(c, cwCfg);
  });
});

describe("psa: configBaseUrl", () => {
  test("ConnectWise", () => assert.equal(configBaseUrl(cwCfg), "https://example.myconnectwise.net/v4_6_release/apis/3.0"));
  test("Autotask", () => assert.equal(configBaseUrl(atCfg), "https://webservices2.autotask.net/ATServicesRest/V1.0"));
  test("HaloPSA", () => assert.equal(configBaseUrl(haloCfg), "https://yourmsp.halopsa.com/api"));
});

describe("psa: openTicket in test mode", () => {
  test("returns a deterministic external_id without hitting the network", async () => {
    const fetchMock = () => { throw new Error("no network allowed in test mode"); };
    const r1 = await openTicket(integration(cwCfg, "test"), base, fetchMock as unknown as typeof fetch);
    const r2 = await openTicket(integration(cwCfg, "test"), base, fetchMock as unknown as typeof fetch);
    assert.equal(r1.externalId, r2.externalId);
    assert.match(r1.externalId, /^connectwise-/);
  });
});

describe("psa: openTicket live mode request shape", () => {
  test("ConnectWise posts to /service/tickets with basic auth and clientId header", async () => {
    const seen: { url: string; init: RequestInit } = { url: "", init: {} };
    const f: typeof fetch = async (url, init) => {
      seen.url = String(url);
      seen.init = init ?? {};
      return new Response(JSON.stringify({ id: 101, _info: { ticket_href: "https://example.myconnectwise.net/t/101" } }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    };
    const result = await openTicket(integration(cwCfg), base, f);
    assert.equal(result.externalId, "101");
    assert.ok(seen.url.endsWith("/service/tickets"));
    const headers = new Headers(seen.init.headers);
    assert.match(headers.get("authorization") || "", /^Basic /);
    assert.equal(headers.get("clientid"), "client-guid");
    const body = JSON.parse(String(seen.init.body));
    assert.equal(body.summary.length <= 100, true);
    assert.equal(body.company.identifier, "42");
    assert.equal(body.board.id, 7);
    assert.equal(body.severity, "High");
  });

  test("ConnectWise surfaces error messages", async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ errors: [{ message: "nope" }] }), { status: 400 });
    await assert.rejects(() => openTicket(integration(cwCfg), base, f), /nope/);
  });

  test("Autotask POSTs with secret headers and numeric CompanyID", async () => {
    const seen: { url: string; init: RequestInit } = { url: "", init: {} };
    const f: typeof fetch = async (url, init) => {
      seen.url = String(url);
      seen.init = init ?? {};
      return new Response(JSON.stringify({ itemId: 9999 }), { status: 200 });
    };
    const r = await openTicket(integration(atCfg), base, f);
    assert.equal(r.externalId, "9999");
    const headers = new Headers(seen.init.headers);
    assert.equal(headers.get("apiintegrationcode"), "ABC");
    assert.equal(headers.get("secret"), "s3cret");
    const body = JSON.parse(String(seen.init.body));
    assert.equal(body.CompanyID, 42);
    assert.equal(body.Priority, 1); // high
    assert.equal(body.QueueID, 29683402);
  });

  test("Autotask refuses non-numeric companyId", async () => {
    const f: typeof fetch = async () => new Response("{}", { status: 200 });
    await assert.rejects(() => openTicket(integration(atCfg), { ...base, companyId: "pear-corp" }, f), /numeric company/);
  });

  test("HaloPSA exchanges credentials for a bearer token and posts a ticket array", async () => {
    const calls: string[] = [];
    const f: typeof fetch = async (url, init) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/auth/token")) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "client_credentials");
        assert.equal(body.get("client_id"), "halo-client");
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      assert.ok(Array.isArray(body));
      assert.equal(body[0].client_id, 42);
      assert.equal(body[0].priority_id, 1);
      assert.equal(body[0].tickettype_id, 24);
      return new Response(JSON.stringify([{ id: 5050 }]), { status: 201 });
    };
    const r = await openTicket(integration(haloCfg), base, f);
    assert.equal(r.externalId, "5050");
    assert.deepEqual(calls, [
      "https://yourmsp.halopsa.com/auth/token",
      "https://yourmsp.halopsa.com/api/Tickets",
    ]);
  });

  test("Inactive integration refuses to open a ticket", async () => {
    const i = { ...integration(cwCfg), active: false };
    await assert.rejects(() => openTicket(i, base, (() => { throw new Error("x"); }) as unknown as typeof fetch), /turned off/);
  });
});
