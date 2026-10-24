// GET /api/cron/daily?job=NAME: one of the once-a-day jobs, called by Vercel Cron.
// Each job has its own schedule in vercel.json, so a slow Microsoft 365 sweep
// can't use up the time the others need.
//   cleanup      delete expired sessions and old scans
//   m365_sync    re-check Microsoft 365
//   snapshot     save each client's risk counts for the trend chart
//   mail_weekly  queue weekly summaries

import { NextResponse } from "next/server";
import { cronAuthorized, runJob } from "@/lib/cron.ts";
import { cleanup } from "@/scripts/cleanup.ts";
import { syncAll } from "@/scripts/m365-sync.ts";
import { snapshotAll } from "@/scripts/snapshot.ts";
import { queueAllWeekly } from "@/scripts/weekly.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOBS: Record<string, (adminUrl: string) => Promise<unknown>> = {
  cleanup: (url) => cleanup(url, Number(process.env.SCAN_KEEP_DAYS) || 90),
  m365_sync: (url) => syncAll(url),
  snapshot: (url) => snapshotAll(url),
  mail_weekly: (url) => queueAllWeekly(url),
};

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new NextResponse("Not found", { status: 404 });
  const job = new URL(req.url).searchParams.get("job") ?? "";
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ ok: false, error: `unknown job, use one of: ${Object.keys(JOBS).join(", ")}` }, { status: 400 });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) return NextResponse.json({ ok: false, error: "DATABASE_ADMIN_URL is not set" }, { status: 500 });
  const run = await runJob(adminUrl, job, () => fn(adminUrl));
  return NextResponse.json(run, { status: run.ok ? 200 : 500 });
}
