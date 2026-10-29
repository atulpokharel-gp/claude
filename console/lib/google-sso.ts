// "Sign in with Google" (OpenID Connect against Google). Uses GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET; add the callback URL /api/auth/google/callback to that
// OAuth client's "Authorised redirect URIs" in the Google Cloud Console.
//
// Protections mirror the Microsoft flow: PKCE, a random state and nonce kept in
// a signed cookie, the ID token taken straight from Google's token endpoint over
// HTTPS (so its contents can be trusted without a signature check, OpenID
// Connect Core 3.1.3.7), and audience, issuer, nonce, expiry and
// email-verified checks.

import { createHash, randomBytes } from "node:crypto";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
// Google uses both spellings of the issuer across its surfaces; accept either.
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SUB = /^[0-9]{1,40}$/;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class GoogleSsoError extends Error {}

export function googleClient(): { id: string; secret: string } | null {
  const id = process.env.GOOGLE_CLIENT_ID || "";
  const secret = process.env.GOOGLE_CLIENT_SECRET || "";
  return id && secret ? { id, secret } : null;
}

export function hasGoogleSso(): boolean {
  return googleClient() !== null;
}

export interface GoogleStart {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

/** Where to send the browser, and the values to keep (signed) until it comes back. */
export function startSignIn(redirectUri: string): GoogleStart {
  const c = googleClient();
  if (!c) throw new GoogleSsoError("Sign in with Google isn't set up on this server.");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    client_id: c.id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return { url: `${AUTH}?${q}`, state, nonce, verifier };
}

export interface GoogleAccount {
  /** The OpenID Connect subject: stable, never reassigned. Used to match. */
  sub: string;
  /** For display only. Never use it to match accounts. */
  label: string;
  name: string;
}

interface Claims {
  aud?: string;
  iss?: string;
  sub?: string;
  nonce?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

/** Checks the ID token's claims. Exported for tests. */
export function checkClaims(claims: Claims, nonce: string, clientId: string, now = Date.now()): GoogleAccount {
  if (claims.aud !== clientId) throw new GoogleSsoError("That sign-in was meant for a different app.");
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new GoogleSsoError("That sign-in didn't come from Google.");
  if (!claims.sub || !SUB.test(claims.sub)) throw new GoogleSsoError("Google sent an unexpected account id.");
  if (!claims.nonce || claims.nonce !== nonce) throw new GoogleSsoError("That sign-in has expired. Try again.");
  const skew = 5 * 60;
  if (!claims.exp || claims.exp + skew < now / 1000) throw new GoogleSsoError("That sign-in has expired. Try again.");
  if (claims.nbf && claims.nbf - skew > now / 1000) throw new GoogleSsoError("That sign-in isn't valid yet. Check the server's clock.");
  // email_verified comes back as a boolean or (historically) the string "true".
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new GoogleSsoError("Verify your email with Google before signing in this way.");
  }
  return {
    sub: claims.sub,
    label: (claims.email ?? "").slice(0, 320),
    name: (claims.name ?? "").slice(0, 200),
  };
}

/** Swaps the code for an ID token and returns the account it names. */
export async function finishSignIn(code: string, verifier: string, nonce: string, redirectUri: string, f: Fetch = fetch): Promise<GoogleAccount> {
  const c = googleClient();
  if (!c) throw new GoogleSsoError("Sign in with Google isn't set up on this server.");
  const res = await f(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.id_token) {
    throw new GoogleSsoError(`Google refused the sign-in: ${(body.error_description ?? body.error ?? res.statusText).split("\n")[0].slice(0, 200)}`);
  }
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw new GoogleSsoError("Google sent an unreadable sign-in token.");
  }
  return checkClaims(claims, nonce, c.id);
}
