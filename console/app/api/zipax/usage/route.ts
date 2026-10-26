// Laptops send Zipax usage uploads here:
//   POST /api/zipax/usage  Authorization: Bearer zlu_...  body: Zipax JSON upload

import { hasDatabase } from "@/lib/db.ts";
import { allow, clientIp } from "@/lib/ratelimit.ts";
import { tokenHash } from "@/lib/secrets.ts";
import { ingestZipax, MAX_ZIPAX_BYTES, ZipaxError } from "@/lib/zipax.ts";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^(zlu|agu)_[A-Za-z0-9_-]{32,64}$/;

function reply(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

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
  if (!hasDatabase()) {
    return reply(503, { error: "This console runs in demo mode and doesn't accept uploads." });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!TOKEN_RE.test(token)) return reply(401, { error: "Missing or malformed upload token." });

  const ip = clientIp(req.headers.get("x-forwarded-for"));
  const keyedToken = tokenHash(token).toString("hex");
  // Same rate-limit buckets as scan uploads so a device cannot blow its
  // budget by splitting across endpoints.
  if (!(await allow("scanUploadToken", keyedToken))) {
    return reply(429, { error: "Too many uploads from this token. Try again in an hour." });
  }
  if (ip && !(await allow("scanUploadIp", ip))) {
    return reply(429, { error: "Too many uploads from your network. Try again in an hour." });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ZIPAX_BYTES) {
    return reply(413, { error: "Upload is too large." });
  }
  const text = await readLimited(req, MAX_ZIPAX_BYTES);
  if (text === null) return reply(413, { error: "Upload is too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "Body must be a JSON upload." });
  }
  try {
    const { deviceId, inserted, updated } = await ingestZipax(token, body);
    return reply(201, { ok: true, deviceId, inserted, updated });
  } catch (err) {
    if (err instanceof ZipaxError) return reply(err.status, { error: err.message });
    console.error("zipax upload failed", err);
    return reply(500, { error: "Couldn't save the usage upload. Try again later." });
  }
}
