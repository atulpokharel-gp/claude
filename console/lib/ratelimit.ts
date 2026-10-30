// Counts attempts in the database so limits hold across restarts and servers.

import { lookup } from "./db.ts";

export const LIMITS = {
  signInEmail: { window: 15 * 60, max: 10 },
  signInIp: { window: 15 * 60, max: 50 },
  mfa: { window: 15 * 60, max: 10 },
  signUpIp: { window: 60 * 60, max: 5 },
  invite: { window: 60 * 60, max: 30 },
  // Forgot-password requests: per email and per source IP, so a link can't be
  // used to flood someone's inbox or to probe which addresses have accounts.
  passwordReset: { window: 60 * 60, max: 5 },
  passwordResetIp: { window: 60 * 60, max: 20 },
  // A laptop normally sends one scan a day; 60/hour per token still fits
  // --all-users and ad-hoc retries, but a leaked token can't flood.
  scanUploadToken: { window: 60 * 60, max: 60 },
  // Per source IP, a touch more generous so a shared RMM egress IP covering
  // many clients isn't throttled.
  scanUploadIp: { window: 60 * 60, max: 600 },
  // Clients and tokens are owner/member actions and should never be fast;
  // this catches a runaway script or a stolen session.
  createClient: { window: 60 * 60, max: 50 },
  createUploadToken: { window: 60 * 60, max: 100 },
  // One visitor should not be able to fake a wave on the public /live
  // counters. Generous because a shared NAT can cover many real browsers.
  pulseIp: { window: 60 * 60, max: 600 },
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
