// Pure tests for the RMM adapter: config validation, device fetching per
// vendor and the test-mode mock.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cleanRmmConfig,
  configBaseUrl,
  fetchDevices,
  RmmError,
  type NinjaOneConfig,
  type DattoConfig,
  type AutomateConfig,
  type RmmIntegrationWithConfig,
} from "./rmm.ts";

process.env.APP_SECRET ??= randomBytes(32).toString("base64");

const ninja: NinjaOneConfig = { kind: "ninjaone", host: "us.ninjarmm.com", clientId: "n-id", clientSecret: "n-sec" };
const datto: DattoConfig = { kind: "datto", platform: "pinotage", apiKey: "key", apiSecret: "sec" };
const auto: AutomateConfig = { kind: "automate", host: "automate.msp.com", clientId: "cwa", username: "u", password: "p" };

function integration(cfg: NinjaOneConfig | DattoConfig | AutomateConfig, mode: "live" | "test" = "live"): RmmIntegrationWithConfig {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    mspId: "22222222-2222-2222-2222-222222222222",
    kind: cfg.kind, name: "T", baseUrl: configBaseUrl(cfg),
    mode, active: true, lastSyncAt: null, lastError: "", createdAt: new Date().toISOString(),
    config: cfg,
  };
}

describe("rmm: cleanRmmConfig", () => {
  test("NinjaOne refuses an unknown host", () => {
    assert.throws(() => cleanRmmConfig({ kind: "ninjaone", host: "ninja.evil.com", clientId: "a", clientSecret: "b" }), /host must be one of/);
  });

  test("Datto platform is a short identifier", () => {
    assert.throws(() => cleanRmmConfig({ kind: "datto", platform: "has spaces", apiKey: "a", apiSecret: "b" }), /platform/);
  });

  test("Automate host must look like a domain", () => {
    assert.throws(() => cleanRmmConfig({ kind: "automate", host: "no_dot", clientId: "a", username: "u", password: "p" }), /host/);
  });

  test("Good configs roundtrip", () => {
    assert.deepEqual(cleanRmmConfig(ninja), ninja);
    assert.deepEqual(cleanRmmConfig(datto), datto);
    assert.deepEqual(cleanRmmConfig(auto), auto);
  });
});

describe("rmm: configBaseUrl", () => {
  test("NinjaOne", () => assert.equal(configBaseUrl(ninja), "https://us.ninjarmm.com"));
  test("Datto", () => assert.equal(configBaseUrl(datto), "https://pinotage-api.centrastage.net"));
  test("Automate", () => assert.equal(configBaseUrl(auto), "https://automate.msp.com"));
});

describe("rmm: fetchDevices test mode", () => {
  test("returns a deterministic fake device list without network", async () => {
    const fetchMock = () => { throw new Error("no network"); };
    const first = await fetchDevices(integration(ninja, "test"), "ninja-org-7", fetchMock as unknown as typeof fetch);
    const second = await fetchDevices(integration(ninja, "test"), "ninja-org-7", fetchMock as unknown as typeof fetch);
    assert.deepEqual(first.map((d) => d.rmmDeviceId), second.map((d) => d.rmmDeviceId));
    assert.ok(first.length >= 2);
    for (const d of first) assert.match(d.rmmDeviceId, /^ninjaone-/);
  });

  test("test mode refuses an empty org id", async () => {
    await assert.rejects(() => fetchDevices(integration(datto, "test"), "", fetch), /organization ID/);
  });

  test("test mode refuses an inactive integration", async () => {
    const inactive = { ...integration(auto, "test"), active: false };
    await assert.rejects(() => fetchDevices(inactive, "1", fetch), /turned off/);
  });
});

describe("rmm: fetchDevices live request shape", () => {
  test("NinjaOne hits /oauth/token then /v2/organization/{id}/devices", async () => {
    const seen: string[] = [];
    const f: typeof fetch = async (url, init) => {
      const u = String(url);
      seen.push(u);
      if (u.endsWith("/oauth/token")) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_id"), "n-id");
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          { id: 1, systemName: "LAPTOP-1", nodeClass: "WINDOWS_WORKSTATION", lastContact: 1_700_000_000, tags: ["sales"] },
          { id: 2, dnsName: "LAPTOP-2.local", nodeClass: "MAC", offline: true },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const devices = await fetchDevices(integration(ninja), "42", f);
    assert.deepEqual(seen, ["https://us.ninjarmm.com/oauth/token", "https://us.ninjarmm.com/v2/organization/42/devices"]);
    assert.equal(devices.length, 2);
    assert.equal(devices[0].hostname, "LAPTOP-1");
    assert.equal(devices[0].tags[0], "sales");
    assert.ok(devices[0].lastSeenAt);
  });

  test("NinjaOne refuses a non-numeric org id", async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    await assert.rejects(() => fetchDevices(integration(ninja), "not-a-number", f), /numeric/);
  });

  test("Datto uses basic auth and returns body.devices", async () => {
    const f: typeof fetch = async (url, init) => {
      assert.equal(String(url), "https://pinotage-api.centrastage.net/api/v2/site/abc/devices");
      const headers = new Headers(init?.headers);
      assert.match(headers.get("authorization") || "", /^Basic /);
      return new Response(JSON.stringify({ devices: [{ uid: "u1", hostname: "d-1", operatingSystem: "Windows 11", lastSeen: "2026-10-24T00:00:00Z", tags: [{ name: "finance" }] }] }), { status: 200 });
    };
    const devices = await fetchDevices(integration(datto), "abc", f);
    assert.equal(devices.length, 1);
    assert.deepEqual(devices[0].tags, ["finance"]);
    assert.equal(devices[0].rmmDeviceId, "u1");
  });

  test("Automate exchanges credentials for a Token then lists computers", async () => {
    const seen: string[] = [];
    const f: typeof fetch = async (url, init) => {
      const u = String(url);
      seen.push(u);
      if (u.endsWith("/cwa/api/v1/apitoken")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.username, "u");
        return new Response(JSON.stringify({ Token: "cwa-tok" }), { status: 200 });
      }
      return new Response(
        JSON.stringify([{ Id: 7, ComputerName: "DESKTOP-7", OperatingSystemName: "Windows 10 Pro", LastContact: "2026-10-24T00:00:00Z" }]),
        { status: 200 },
      );
    };
    const devices = await fetchDevices(integration(auto), "99", f);
    assert.deepEqual(seen, [
      "https://automate.msp.com/cwa/api/v1/apitoken",
      "https://automate.msp.com/cwa/api/v1/clients/99/computers?pagesize=500",
    ]);
    assert.equal(devices[0].hostname, "DESKTOP-7");
  });

  test("surfaces vendor error messages", async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ error_description: "nope" }), { status: 401 });
    await assert.rejects(() => fetchDevices(integration(ninja), "42", f), /nope/);
  });
});
