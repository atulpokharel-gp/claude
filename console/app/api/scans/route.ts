// Laptops send scan reports here:
//   POST /api/scans  Authorization: Bearer zlu_...  body: zinloop JSON report

import { hasDatabase } from "@/lib/db.ts";
import { allow, clientIp } from "@/lib/ratelimit.ts";
import { tokenHash } from "@/lib/secrets.ts";
import { ingestScan, MAX_REPORT_BYTES, UploadError } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

// A token is a prefix plus 32 bytes of base64url (43 chars). Anything else is
// malformed and never reaches the DB.
const TOKEN_RE = /^(zlu|agu)_[A-Za-z0-9_-]{32,64}$/;

function reply(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Reads the body, giving up as soon as it passes limit bytes (chunked uploads have no Content-Length). */
async function readLimited(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: Request) {
  if (!hasDatabase()) return reply(503, { error: "This console runs in demo mode and doesn't accept uploads." });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // Shape check first so a flood of garbage doesn't touch the DB. The
  // response is deliberately the same as "unknown token" so an attacker
  // can't learn which prefix we're using.
  if (!TOKEN_RE.test(token)) {
    return reply(401, { error: "Missing or malformed upload token." });
  }
  const ip = clientIp(req.headers.get("x-forwarded-for"));
  // Per-token first (bounded by the sender's own token), per-IP second
  // (shared across clients behind one egress).
  const keyedToken = tokenHash(token).toString("hex");
  if (!(await allow("scanUploadToken", keyedToken))) {
    return reply(429, { error: "Too many scans from this token. Try again in an hour." });
  }
  if (ip && !(await allow("scanUploadIp", ip))) {
    return reply(429, { error: "Too many scans from your network. Try again in an hour." });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) {
    return reply(413, { error: "Report is too large." });
  }
  const text = await readLimited(req, MAX_REPORT_BYTES);
  if (text === null) return reply(413, { error: "Report is too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "Body must be the scanner's JSON report." });
  }
  try {
    const { deviceId } = await ingestScan(token, body);
    return reply(201, { ok: true, deviceId });
  } catch (err) {
    if (err instanceof UploadError) return reply(err.status, { error: err.message });
    console.error("scan upload failed", err);
    return reply(500, { error: "Couldn't save the scan. Try again later." });
  }
}
