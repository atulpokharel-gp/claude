// GET /api/cron/daily: the once-a-day jobs. Called by Vercel Cron.
// Deletes expired sessions and old scans, re-checks Microsoft 365, saves each
// client's risk counts for the trend chart, and queues weekly summaries.

import { NextResponse } from "next/server";
import { cronAuthorized, runJob } from "@/lib/cron.ts";
import { cleanup } from "@/scripts/cleanup.ts";
import { syncAll } from "@/scripts/m365-sync.ts";
import { snapshotAll } from "@/scripts/snapshot.ts";
import { queueAllWeekly } from "@/scripts/weekly.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new NextResponse("Not found", { status: 404 });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) return NextResponse.json({ ok: false, error: "DATABASE_ADMIN_URL is not set" }, { status: 500 });
  // One after another, in the same order as the Docker maintenance job.
  const runs = [
    await runJob(adminUrl, "cleanup", () => cleanup(adminUrl, Number(process.env.SCAN_KEEP_DAYS) || 90)),
    await runJob(adminUrl, "m365_sync", () => syncAll(adminUrl)),
    await runJob(adminUrl, "snapshot", () => snapshotAll(adminUrl)),
    await runJob(adminUrl, "mail_weekly", () => queueAllWeekly(adminUrl)),
  ];
  const ok = runs.every((r) => r.ok);
  return NextResponse.json({ ok, runs }, { status: ok ? 200 : 500 });
}
