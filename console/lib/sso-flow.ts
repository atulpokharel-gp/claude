// The short-lived signed cookie that carries a Microsoft sign-in's state,
// nonce and PKCE verifier from /start to /callback.

import { cookies } from "next/headers";
import { sign, verifySigned } from "./crypto.ts";

const COOKIE = "zl_sso";
const PATH = "/api/auth/microsoft";
const SECONDS = 10 * 60;

export interface SsoFlow {
  /** state, nonce, PKCE verifier */
  s: string;
  n: string;
  v: string;
  mode: "signin" | "link";
  /** For "link": the user who started it. */
  u?: string;
}

export function consoleBase(req: Request): string {
  return (process.env.CONSOLE_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
}

export function redirectUri(req: Request): string {
  return `${consoleBase(req)}/api/auth/microsoft/callback`;
}

export async function saveFlow(flow: SsoFlow): Promise<void> {
  (await cookies()).set(COOKIE, sign("sso", flow, SECONDS), {
    httpOnly: true,
    // Lax: sent on Microsoft's redirect back (a top-level GET), not on cross-site POSTs.
    sameSite: "lax",
    secure: process.env.ALLOW_HTTP_COOKIES !== "1",
    path: PATH,
    maxAge: SECONDS,
  });
}

/** Reads and deletes the flow cookie: each sign-in attempt can finish once. */
export async function takeFlow(): Promise<SsoFlow | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: PATH });
  return verifySigned<SsoFlow>("sso", raw);
}
