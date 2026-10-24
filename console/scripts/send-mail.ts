// Delivers queued emails (alerts and weekly summaries) over SMTP, with retries.
// Run every few minutes:
//   DATABASE_ADMIN_URL=postgres://owner... SMTP_URL=smtps://user:pass@smtp.example.com MAIL_FROM="Zinloop <alerts@zinloop.com>" npm run mail:send
// Without SMTP_URL nothing is sent and emails wait in the outbox.

import { fileURLToPath } from "node:url";
import pg from "pg";
import { recordRun } from "./job-runs.ts";

export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}
export interface Transport {
  sendMail(m: Mail): Promise<unknown>;
}

/** Gives up on an email after this many failed tries (about a day with the backoff below). */
export const MAX_ATTEMPTS = 8;

/**
 * Sends up to `max` due emails, one row at a time so several senders can run
 * at once without sending the same email twice. Returns counts.
 */
export async function sendPending(adminUrl: string, transport: Transport, from: string, max = 200): Promise<{ sent: number; failed: number }> {
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  let sent = 0;
  let failed = 0;
  try {
    for (let i = 0; i < max; i++) {
      await db.query("begin");
      const row = (
        await db.query<{ id: string; to_email: string; subject: string; body_text: string; body_html: string; unsubscribe_url: string; attempts: number }>(
          `select id, to_email, subject, body_text, body_html, unsubscribe_url, attempts from outbox
           where sent_at is null and attempts < $1 and next_try_at <= now()
           order by id limit 1 for update skip locked`,
          [MAX_ATTEMPTS],
        )
      ).rows[0];
      if (!row) {
        await db.query("commit");
        break;
      }
      const headers: Record<string, string> = {};
      if (row.unsubscribe_url) {
        // The email's link opens a confirmation page; mail apps' one-click button posts straight to the API.
        headers["List-Unsubscribe"] = `<${row.unsubscribe_url.replace("/unsubscribe?", "/api/unsubscribe?")}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }
      try {
        await transport.sendMail({ from, to: row.to_email, subject: row.subject, text: row.body_text, html: row.body_html, headers });
        await db.query("update outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1", [row.id]);
        sent++;
      } catch (err) {
        // Wait 2, 4, 8 ... minutes before trying again.
        await db.query(
          "update outbox set attempts = attempts + 1, last_error = $2, next_try_at = now() + make_interval(mins => $3) where id = $1",
          [row.id, String((err as Error).message ?? err).slice(0, 500), 2 ** (row.attempts + 1)],
        );
        failed++;
      }
      await db.query("commit");
    }
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
  return { sent, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const smtp = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM;
  if (!adminUrl) {
    console.error("Set DATABASE_ADMIN_URL (owner).");
    process.exit(1);
  }
  if (!smtp || !from) {
    console.log("SMTP_URL or MAIL_FROM isn't set, so no email was sent. Queued emails will wait.");
    process.exit(0);
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(smtp);
  sendPending(adminUrl, transport as unknown as Transport, from)
    .then(async ({ sent, failed }) => {
      if (sent || failed) console.log(`Sent ${sent} emails${failed ? `, ${failed} failed and will be retried` : ""}.`);
      // Every send failing means the mail server is down or rejecting us.
      await recordRun(adminUrl, "mail_send", sent === 0 && failed > 0 ? new Error(`${failed} emails failed to send`) : undefined);
    })
    .catch(async (err) => {
      console.error(err.message);
      await recordRun(adminUrl, "mail_send", err);
      process.exitCode = 1;
    })
    .finally(() => transport.close());
}
