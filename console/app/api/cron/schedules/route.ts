// GET /api/cron/schedules: fires every scheduled client report whose
// next_run_at has passed. Called hourly by Vercel Cron (vercel.json).
// A heavy job (M365 sweep) running at the same time can't delay it because
// schedules has its own path.

import { NextResponse } from "next/server";
import { cronAuthorized, runJob } from "@/lib/cron.ts";
import { fireDueSchedules } from "@/scripts/schedules.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new NextResponse("Not found", { status: 404 });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) return NextResponse.json({ ok: false, error: "DATABASE_ADMIN_URL is not set" }, { status: 500 });
  const run = await runJob(adminUrl, "schedules", () => fireDueSchedules(adminUrl));
  return NextResponse.json(run, { status: run.ok ? 200 : 500 });
}
