// Counts attempts in the database so limits hold across restarts and servers.

import { lookup } from "./db.ts";

export const LIMITS = {
  signInEmail: { window: 15 * 60, max: 10 },
  signInIp: { window: 15 * 60, max: 50 },
  mfa: { window: 15 * 60, max: 10 },
  signUpIp: { window: 60 * 60, max: 5 },
  invite: { window: 60 * 60, max: 30 },
  pulseIp: { window: 60, max: 60 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Records an attempt. Returns false when the limit for this key is used up. */
export async function allow(name: LimitName, key: string): Promise<boolean> {
  const { window, max } = LIMITS[name];
  const row = await lookup<{ ok: boolean }>("select rate_limit_hit($1, $2, $3) as ok", [`${name}:${key}`, window, max]);
  return row?.ok === true;
}

/**
 * The caller's address from X-Forwarded-For, only when TRUST_PROXY=1 says the
 * console sits behind a proxy that sets it. Otherwise null, and per-address
 * limits are skipped (anyone could fake the header).
 */
export function clientIp(forwardedFor: string | null): string | null {
  if (process.env.TRUST_PROXY !== "1" || !forwardedFor) return null;
  const parts = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  // The proxy appends the address it saw, so the last entry is the one we trust.
  return parts.at(-1) ?? null;
}
