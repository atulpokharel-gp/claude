// Laptops send scan reports here:
//   POST /api/scans  Authorization: Bearer agu_...  body: agentscan JSON report

import { hasDatabase } from "@/lib/db.ts";
import { ingestScan, MAX_REPORT_BYTES, UploadError } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

function reply(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!hasDatabase()) return reply(503, { error: "This console runs in demo mode and doesn't accept uploads." });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) {
    return reply(413, { error: "Report is too large." });
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) return reply(413, { error: "Report is too large." });
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
