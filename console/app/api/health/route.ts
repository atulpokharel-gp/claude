// GET /api/health        200 when the console can reach its database (for Docker and deploys).
// GET /api/health?jobs=1 also 503 when a background job is failing or late (for an uptime monitor).

import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/health.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const withJobs = new URL(req.url).searchParams.get("jobs") === "1";
  const h = await checkHealth(withJobs);
  return NextResponse.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
