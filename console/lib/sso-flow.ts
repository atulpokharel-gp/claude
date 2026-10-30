// The short-lived signed cookie that carries an SSO sign-in's state, nonce and
// PKCE verifier from /start to /callback. Shared by the Microsoft and Google
// flows; each provider gets its own cookie, scoped to its own callback path.

import { cookies } from "next/headers";
import { sign, verifySigned } from "./crypto.ts";

export type Provider = "microsoft" | "google";

const COOKIE: Record<Provider, string> = { microsoft: "zl_sso", google: "zl_sso_google" };
const PATH: Record<Provider, string> = { microsoft: "/api/auth/microsoft", google: "/api/auth/google" };
const SECONDS = 10 * 60;

export interface SsoFlow {
  /** state, nonce, PKCE verifier */
  s: string;
  n: string;
  v: string;
  mode: "signin" | "link" | "signup";
  /** For "link": the user who started it. */
  u?: string;
}

export function consoleBase(req: Request): string {
  return (process.env.CONSOLE_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
}

export function redirectUri(req: Request, provider: Provider = "microsoft"): string {
  return `${consoleBase(req)}${PATH[provider]}/callback`;
}

export async function saveFlow(flow: SsoFlow, provider: Provider = "microsoft"): Promise<void> {
  (await cookies()).set(COOKIE[provider], sign("sso", flow, SECONDS), {
    httpOnly: true,
    // Lax: sent on the provider's redirect back (a top-level GET), not on cross-site POSTs.
    sameSite: "lax",
    secure: process.env.ALLOW_HTTP_COOKIES !== "1",
    path: PATH[provider],
    maxAge: SECONDS,
  });
}

/** Reads and deletes the flow cookie: each sign-in attempt can finish once. */
export async function takeFlow(provider: Provider = "microsoft"): Promise<SsoFlow | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE[provider])?.value;
  jar.delete({ name: COOKIE[provider], path: PATH[provider] });
  return verifySigned<SsoFlow>("sso", raw);
}
