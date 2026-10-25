// POST /api/public/pulse — bumps the public counters shown on /live.
// Only accepts known bucket names, caps the per-request bump at 1, and
// takes nothing else. Rate-limited per IP where TRUST_PROXY is set.

import { allow } from "@/lib/ratelimit.ts";
import { bump, isValidBucket } from "@/lib/pulse.ts";
import { clientIp } from "@/lib/ratelimit.ts";

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers.get("x-forwarded-for"));
  // Reuse an existing per-IP limit so one visitor can't fake a wave.
  if (ip && !(await allow("pulseIp", ip))) {
    return new Response("too many", { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof body !== "object" || body === null) return new Response("bad body", { status: 400 });
  const b = (body as { buckets?: unknown }).buckets;
  if (!Array.isArray(b)) return new Response("bad body", { status: 400 });
  const buckets = b.filter((x): x is string => typeof x === "string" && isValidBucket(x)).slice(0, 4);
  await bump(buckets, 1);
  return new Response(null, { status: 204 });
}
