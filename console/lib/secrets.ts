// Passwords, session tokens and upload tokens.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), want.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A random token for a cookie or a laptop, with a prefix that says what it is. */
export function newToken(prefix: "ags" | "agu"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Tokens are stored only as a SHA-256 hash. They are long and random, so no salt is needed. */
export function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// A fixed hash to verify against when the email is unknown, so sign-in takes
// the same time whether or not the account exists.
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
