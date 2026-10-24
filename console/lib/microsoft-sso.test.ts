import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, finishSignIn, startSignIn, SsoError } from "./microsoft-sso.ts";

const TID = "11111111-2222-3333-4444-555555555555";
const OID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const now = Date.parse("2026-10-24T12:00:00Z");
const good = { aud: "app-id", iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, oid: OID, nonce: "n1", exp: now / 1000 + 600, preferred_username: "dana@contoso.example", name: "Dana" };

test("ID token claims are checked before anyone is signed in", () => {
  assert.deepEqual(checkClaims(good, "n1", "app-id", now), { tenantId: TID, objectId: OID, label: "dana@contoso.example", name: "Dana" });
  assert.throws(() => checkClaims({ ...good, aud: "other-app" }, "n1", "app-id", now), /different app/);
  assert.throws(() => checkClaims({ ...good, iss: "https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0" }, "n1", "app-id", now), /didn't come from Microsoft/);
  assert.throws(() => checkClaims({ ...good, nonce: "replayed" }, "n1", "app-id", now), /expired/);
  assert.throws(() => checkClaims({ ...good, exp: now / 1000 - 3600 }, "n1", "app-id", now), /expired/);
  assert.throws(() => checkClaims({ ...good, oid: undefined }, "n1", "app-id", now), /work or school/);
  // Personal Microsoft accounts have this fixed tenant; they're refused by the "organizations" endpoint, and have no matching issuer here.
  assert.throws(() => checkClaims({ ...good, tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }, "n1", "app-id", now), SsoError);
});

test("the sign-in uses PKCE, state and nonce, and the token exchange sends the verifier", async () => {
  process.env.M365_CLIENT_ID = "app-id";
  process.env.M365_CLIENT_SECRET = "secret";
  const s = startSignIn("https://app.example/api/auth/microsoft/callback");
  const u = new URL(s.url);
  assert.equal(u.pathname, "/organizations/oauth2/v2.0/authorize");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), s.state);
  assert.equal(u.searchParams.get("nonce"), s.nonce);
  assert.notEqual(u.searchParams.get("code_challenge"), s.verifier);
  let sent: URLSearchParams | undefined;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    sent = new URLSearchParams(String(init!.body));
    const claims = { ...good, nonce: s.nonce, exp: Date.now() / 1000 + 600 };
    return new Response(JSON.stringify({ id_token: `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y` }), { status: 200 });
  };
  const account = await finishSignIn("the-code", s.verifier, s.nonce, "https://app.example/api/auth/microsoft/callback", fakeFetch);
  assert.equal(account.objectId, OID);
  assert.equal(sent!.get("code_verifier"), s.verifier);
  assert.equal(sent!.get("client_secret"), "secret");
  const refused = async () => new Response(JSON.stringify({ error_description: "AADSTS70008: expired\nmore" }), { status: 400 });
  await assert.rejects(finishSignIn("c", s.verifier, s.nonce, "r", refused), /Microsoft refused the sign-in: AADSTS70008: expired$/);
  delete process.env.M365_CLIENT_ID;
  delete process.env.M365_CLIENT_SECRET;
});
