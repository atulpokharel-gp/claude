// GET /api/cron/mail: sends queued emails. Called every 5 minutes by Vercel Cron.

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { cronAuthorized, runJob } from "@/lib/cron.ts";
import { sendPending, type Transport } from "@/scripts/send-mail.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new NextResponse("Not found", { status: 404 });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const smtp = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM;
  if (!adminUrl) return NextResponse.json({ ok: false, error: "DATABASE_ADMIN_URL is not set" }, { status: 500 });
  // Without SMTP, emails wait in the outbox (same as the Docker job).
  if (!smtp || !from) return NextResponse.json({ ok: true, skipped: "SMTP_URL or MAIL_FROM isn't set" });
  const transport = nodemailer.createTransport(smtp);
  try {
    const run = await runJob(adminUrl, "mail_send", async () => {
      const r = await sendPending(adminUrl, transport as unknown as Transport, from);
      // Every send failing means the mail server is down or rejecting us.
      if (r.sent === 0 && r.failed > 0) throw new Error(`${r.failed} emails failed to send`);
      return r;
    });
    return NextResponse.json(run, { status: run.ok ? 200 : 500 });
  } finally {
    transport.close();
  }
}
