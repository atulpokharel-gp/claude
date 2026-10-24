// "Sign in with Microsoft" (OpenID Connect against Microsoft Entra ID, work and
// school accounts only). Uses its own Entra app when SSO_CLIENT_ID is set,
// otherwise the Microsoft 365 app (M365_CLIENT_ID); add the callback URL
// /api/auth/microsoft/callback to that app's redirect URIs.
//
// Protections: PKCE, a random state and nonce kept in a signed cookie, the ID
// token taken straight from Microsoft's token endpoint over HTTPS (so its
// contents can be trusted without a signature check, OpenID Connect Core
// 3.1.3.7), and audience, issuer, tenant, nonce and expiry checks.

import { createHash, randomBytes } from "node:crypto";

const LOGIN = "https://login.microsoftonline.com";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class SsoError extends Error {}

export function ssoClient(): { id: string; secret: string } | null {
  const id = process.env.SSO_CLIENT_ID || process.env.M365_CLIENT_ID || "";
  const secret = process.env.SSO_CLIENT_ID ? process.env.SSO_CLIENT_SECRET || "" : process.env.M365_CLIENT_SECRET || "";
  return id && secret ? { id, secret } : null;
}

export function hasSso(): boolean {
  return ssoClient() !== null;
}

export interface SsoStart {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

/** Where to send the browser, and the values to keep (signed) until it comes back. */
export function startSignIn(redirectUri: string): SsoStart {
  const c = ssoClient();
  if (!c) throw new SsoError("Sign in with Microsoft isn't set up on this server.");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    client_id: c.id,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  // "organizations": work and school accounts only, from any tenant.
  return { url: `${LOGIN}/organizations/oauth2/v2.0/authorize?${q}`, state, nonce, verifier };
}

export interface MicrosoftAccount {
  tenantId: string;
  objectId: string;
  /** For display only. Never use it to match accounts. */
  label: string;
  name: string;
}

interface Claims {
  aud?: string;
  iss?: string;
  tid?: string;
  oid?: string;
  nonce?: string;
  exp?: number;
  nbf?: number;
  name?: string;
  preferred_username?: string;
  email?: string;
}

/** Checks the ID token's claims. Exported for tests. */
export function checkClaims(claims: Claims, nonce: string, clientId: string, now = Date.now()): MicrosoftAccount {
  const tid = claims.tid?.toLowerCase() ?? "";
  const oid = claims.oid?.toLowerCase() ?? "";
  if (claims.aud !== clientId) throw new SsoError("That sign-in was meant for a different app.");
  if (!GUID.test(tid) || !GUID.test(oid)) throw new SsoError("Use a work or school Microsoft account.");
  if (claims.iss !== `${LOGIN}/${tid}/v2.0`) throw new SsoError("That sign-in didn't come from Microsoft.");
  if (!claims.nonce || claims.nonce !== nonce) throw new SsoError("That sign-in has expired. Try again.");
  const skew = 5 * 60;
  if (!claims.exp || claims.exp + skew < now / 1000) throw new SsoError("That sign-in has expired. Try again.");
  if (claims.nbf && claims.nbf - skew > now / 1000) throw new SsoError("That sign-in isn't valid yet. Check the server's clock.");
  return {
    tenantId: tid,
    objectId: oid,
    label: (claims.preferred_username || claims.email || "").slice(0, 320),
    name: (claims.name ?? "").slice(0, 200),
  };
}

/** Swaps the code for an ID token and returns the account it names. */
export async function finishSignIn(code: string, verifier: string, nonce: string, redirectUri: string, f: Fetch = fetch): Promise<MicrosoftAccount> {
  const c = ssoClient();
  if (!c) throw new SsoError("Sign in with Microsoft isn't set up on this server.");
  const res = await f(`${LOGIN}/organizations/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: "openid profile email",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!res.ok || !body.id_token) {
    throw new SsoError(`Microsoft refused the sign-in: ${(body.error_description ?? res.statusText).split("\n")[0].slice(0, 200)}`);
  }
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw new SsoError("Microsoft sent an unreadable sign-in token.");
  }
  return checkClaims(claims, nonce, c.id);
}
