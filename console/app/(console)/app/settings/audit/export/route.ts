// GET /app/settings/audit/export: the audit log as CSV (owner only, up to 5,000 entries).

import { NextResponse } from "next/server";
import { auditCsv, listAudit } from "@/lib/audit.ts";
import { currentSession } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await currentSession();
  if (!s || s.role !== "owner" || (s.requireMfa && !s.mfa)) return new NextResponse("Not allowed.", { status: 403 });
  const action = new URL(req.url).searchParams.get("action") ?? undefined;
  const csv = auditCsv(await listAudit(s.mspId, { action, limit: 5000 }));
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zinloop-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
