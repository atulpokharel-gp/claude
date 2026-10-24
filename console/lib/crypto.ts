// Encryption and signing with the console's APP_SECRET (32 random bytes,
// base64). Used for authenticator secrets at rest and short-lived signed
// values such as the "password checked, waiting for the code" cookie.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class MissingSecretError extends Error {
  constructor() {
    super("APP_SECRET is not set. Generate one with: openssl rand -base64 32");
  }
}

function key(): Buffer {
  const raw = process.env.APP_SECRET;
  if (!raw) throw new MissingSecretError();
  const k = Buffer.from(raw, "base64");
  if (k.length < 32) throw new Error("APP_SECRET must be at least 32 bytes, base64-encoded.");
  return k.subarray(0, 32);
}

export function hasAppSecret(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(box: string): string {
  const [v, iv, tag, body] = box.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable encrypted value.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** Signs a JSON value with an expiry. */
export function sign(purpose: string, value: object, ttlSeconds: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ p: purpose, v: value, e: now + ttlSeconds * 1000 })).toString("base64url");
  const mac = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Returns the signed value, or null when it's forged, expired or for another purpose. */
export function verifySigned<T>(purpose: string, token: string | undefined, now = Date.now()): T | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = createHmac("sha256", key()).update(payload).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { p, v, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (p !== purpose || typeof e !== "number" || e < now) return null;
    return v as T;
  } catch {
    return null;
  }
}
