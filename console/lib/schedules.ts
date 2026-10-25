// Scheduled client reports. An MSP can set weekly or monthly delivery per
// client; a cron picks up what's due and queues one PDF-ready email per
// recipient into the outbox. Delivery is the same path the alerts use, so a
// slow mail server never blocks the scheduler.
//
// Who gets a scheduled report:
//   explicit `recipients`, if the schedule has any; otherwise
//   the client's policy.reportRecipients (external contacts) plus the MSP's
//   team members who have weekly_email on.

import { randomUUID } from "node:crypto";
import pg from "pg";
import { audit } from "./audit.ts";
import { consoleBase, unsubscribeUrl } from "./alerts.ts";
import { withTenant } from "./db.ts";
import { oneLine } from "./email.ts";
import { getPolicy } from "./policies.ts";
import { buildReport } from "./report.ts";
import { getClient } from "./store.ts";
import type { Session } from "./auth.ts";
import type { ClientReport } from "./report.ts";
import type { Email } from "./email.ts";

export class ScheduleError extends Error {}

export type ScheduleFrequency = "weekly" | "monthly";

export interface ReportSchedule {
  id: string;
  clientId: string;
  frequency: ScheduleFrequency;
  dayOfPeriod: number;
  hourUtc: number;
  recipients: string[];
  nextRunAt: string;
  lastRunAt: string | null;
  lastError: string;
  active: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  client_id: string;
  frequency: ScheduleFrequency;
  day_of_period: number;
  hour_utc: number;
  recipients: string[];
  next_run_at: Date;
  last_run_at: Date | null;
  last_error: string;
  active: boolean;
  created_at: Date;
}

function rowToSchedule(r: Row): ReportSchedule {
  return {
    id: r.id, clientId: r.client_id, frequency: r.frequency,
    dayOfPeriod: r.day_of_period, hourUtc: r.hour_utc,
    recipients: r.recipients ?? [],
    nextRunAt: r.next_run_at.toISOString(),
    lastRunAt: r.last_run_at?.toISOString() ?? null,
    lastError: r.last_error ?? "",
    active: r.active,
    createdAt: r.created_at.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isUuid(v: string): boolean { return UUID.test(v); }

function cleanRecipients(list: unknown): string[] {
  if (!Array.isArray(list)) throw new ScheduleError("Recipients must be an array of email addresses.");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!EMAIL.test(v) || v.length > 320 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Next UTC moment at hour `h` on day `d` for the given frequency, strictly
 * after `now`. For weekly, `d` is 0 (Sun) .. 6 (Sat); for monthly, 1 .. 28.
 */
export function nextRunAt(frequency: ScheduleFrequency, dayOfPeriod: number, hourUtc: number, now = new Date()): Date {
  const h = Math.max(0, Math.min(23, Math.floor(hourUtc)));
  if (frequency === "weekly") {
    const d = ((Math.floor(dayOfPeriod) % 7) + 7) % 7;
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0, 0));
    const diff = (d - next.getUTCDay() + 7) % 7;
    next.setUTCDate(next.getUTCDate() + diff);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  // monthly
  const d = Math.max(1, Math.min(28, Math.floor(dayOfPeriod)));
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, d, h, 0, 0, 0));
  if (candidate <= now) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = new Date(Date.UTC(year, month, d, h, 0, 0, 0));
  }
  return candidate;
}

export interface SetScheduleInput {
  clientId: string;
  frequency: ScheduleFrequency;
  dayOfPeriod: number;
  hourUtc?: number;
  recipients?: string[];
  active?: boolean;
}

/** Create or replace a client's schedule for one frequency. */
export async function setSchedule(session: Session, input: SetScheduleInput, ip: string | null = null, now = new Date()): Promise<ReportSchedule> {
  if (session.role !== "owner" && session.role !== "member") throw new ScheduleError("Only an owner or member can change report schedules.");
  if (!isUuid(input.clientId)) throw new ScheduleError("That client wasn't found.");
  if (input.frequency !== "weekly" && input.frequency !== "monthly") throw new ScheduleError("Frequency must be weekly or monthly.");
  const day = Math.floor(Number(input.dayOfPeriod));
  if (!Number.isFinite(day)) throw new ScheduleError("Pick a day for the report.");
  if (input.frequency === "weekly" && (day < 0 || day > 6)) throw new ScheduleError("Weekly day must be 0..6 (Sunday..Saturday).");
  if (input.frequency === "monthly" && (day < 1 || day > 28)) throw new ScheduleError("Monthly day must be 1..28.");
  const hour = Math.min(23, Math.max(0, Math.floor(Number(input.hourUtc ?? 13))));
  const recipients = input.recipients === undefined ? [] : cleanRecipients(input.recipients);
  const active = input.active === undefined ? true : Boolean(input.active);
  const nextAt = nextRunAt(input.frequency, day, hour, now);

  return withTenant(session.mspId, async (db) => {
    const client = (await db.query<{ name: string }>("select name from clients where id = $1", [input.clientId])).rows[0];
    if (!client) throw new ScheduleError("That client wasn't found.");
    const id = randomUUID();
    const res = await db.query<Row>(
      `insert into report_schedules (id, msp_id, client_id, frequency, day_of_period, hour_utc, recipients, next_run_at, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id, frequency) do update set
         day_of_period = excluded.day_of_period,
         hour_utc = excluded.hour_utc,
         recipients = excluded.recipients,
         next_run_at = excluded.next_run_at,
         active = excluded.active,
         last_error = ''
       returning *`,
      [id, session.mspId, input.clientId, input.frequency, day, hour, recipients, nextAt, active],
    );
    const row = res.rows[0];
    await audit(session.mspId, { userId: session.userId, email: session.email, ip },
      "report_schedule_set", client.name, { clientId: input.clientId, frequency: input.frequency, dayOfPeriod: day, hourUtc: hour, active }, db);
    return rowToSchedule(row);
  });
}

export async function removeSchedule(session: Session, scheduleId: string, ip: string | null = null): Promise<void> {
  if (session.role !== "owner" && session.role !== "member") throw new ScheduleError("Only an owner or member can remove report schedules.");
  if (!isUuid(scheduleId)) return;
  await withTenant(session.mspId, async (db) => {
    const row = (await db.query<{ client_id: string; frequency: ScheduleFrequency }>("delete from report_schedules where id = $1 returning client_id, frequency", [scheduleId])).rows[0];
    if (row) {
      await audit(session.mspId, { userId: session.userId, email: session.email, ip },
        "report_schedule_removed", "", { clientId: row.client_id, frequency: row.frequency }, db);
    }
  });
}

export async function listSchedules(mspId: string, clientId?: string): Promise<ReportSchedule[]> {
  return withTenant(mspId, async (db) =>
    (await db.query<Row>(
      "select * from report_schedules where ($1::uuid is null or client_id = $1) order by created_at",
      [clientId && isUuid(clientId) ? clientId : null],
    )).rows.map(rowToSchedule),
  );
}

/** Build the email body for one scheduled report. Pure, so it's testable. */
export function scheduledEmail(o: {
  mspName: string;
  frequency: ScheduleFrequency;
  report: ClientReport;
  reportUrl: string | null;
  unsubscribeUrl: string | null;
}): Email {
  const kind = o.frequency === "weekly" ? "Weekly" : "Monthly";
  const subject = `${kind} AI security report: ${oneLine(o.report.clientName, 100)}`;
  const headline = o.report.headline;
  const bullets = o.report.actions.slice(0, 5).map((a) => `- ${a.severity.toUpperCase()}: ${oneLine(a.title, 160)} (${a.tools} tool${a.tools === 1 ? "" : "s"})`);
  const parts = [
    `${o.mspName} — ${kind.toLowerCase()} AI security summary for ${oneLine(o.report.clientName, 160)}`,
    "",
    headline,
    "",
    `High risk: ${o.report.high}`,
    `Medium risk: ${o.report.medium}`,
    `Plain-text keys found: ${o.report.plainKeys}`,
    `Keys moved into the password store: ${o.report.keysProtected}`,
    `Laptops reporting: ${o.report.laptopsReporting} of ${o.report.laptopsExpected}`,
    `Microsoft 365 apps found: ${o.report.m365Apps}`,
  ];
  if (bullets.length) parts.push("", "Top actions:", ...bullets);
  if (o.reportUrl) parts.push("", `Open the full report: ${o.reportUrl}`);
  if (o.unsubscribeUrl) parts.push("", `Stop these emails: ${o.unsubscribeUrl}`);
  const text = parts.join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e5ea;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#5b6475">${esc(o.mspName)} · Zinloop Security</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(kind)} report for ${esc(o.report.clientName)}</h1>
<p style="margin:0 0 12px;line-height:1.5">${esc(headline)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${stat(o.report.high, "high risk", o.report.high > 0)}${stat(o.report.medium, "medium risk")}${stat(o.report.plainKeys, "plain keys", o.report.plainKeys > 0)}
</tr></table>
${o.report.actions.length ? `<h2 style="font-size:16px;margin:20px 0 8px">Top actions</h2><ul style="margin:0;padding-left:20px;line-height:1.6">${o.report.actions.slice(0, 5).map((a) => `<li><b>${esc(a.severity.toUpperCase())}</b>: ${esc(oneLine(a.title, 160))} (${a.tools} tool${a.tools === 1 ? "" : "s"})</li>`).join("")}</ul>` : ""}
${o.reportUrl ? `<p style="margin:20px 0 0"><a href="${esc(o.reportUrl)}" style="display:inline-block;background:#0f6e6e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Open the full report</a></p>` : ""}
</td></tr></table>
<p style="max-width:600px;margin:12px auto 0;font-size:12px;color:#5b6475;line-height:1.5">You get this because ${esc(o.mspName)} scheduled it.${o.unsubscribeUrl ? ` <a href="${esc(o.unsubscribeUrl)}" style="color:#5b6475">Stop these emails</a>.` : ""}</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function stat(n: number | string, label: string, bad = false): string {
  return `<td style="padding:8px;border:1px solid #e2e5ea;border-radius:6px;width:33%"><div style="font-size:22px;font-weight:700;${bad ? "color:#b42318" : ""}">${esc(String(n))}</div><div style="font-size:13px;color:#5b6475">${esc(label)}</div></td>`;
}

type AdminDb = { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: unknown[] }> };

/** Queue emails for a schedule row. Returns the number of emails queued. */
async function runOne(adminDb: AdminDb, row: Row, mspId: string, mspName: string, now: Date): Promise<number> {
  const got = await getClient(mspId, row.client_id, now);
  if (!got) {
    await adminDb.query("update report_schedules set last_run_at = $2, last_error = $3, next_run_at = $4 where id = $1",
      [row.id, now, "Client not found", nextRunAt(row.frequency, row.day_of_period, row.hour_utc, now)]);
    return 0;
  }
  const report = buildReport(got.client, mspName, now);
  const base = consoleBase();
  const reportUrl = base ? `${base}/app/clients/${row.client_id}/report` : null;

  let recipients = (row.recipients ?? []).slice();
  // Default recipients: external contacts from the policy plus the team.
  if (recipients.length === 0) {
    const policy = await getPolicy(mspId, row.client_id);
    recipients = policy.reportRecipients.slice();
    const team = await withTenant(mspId, async (db) =>
      (await db.query<{ email: string; id: string }>(
        "select id, email from users where role in ('owner', 'member', 'technician') and weekly_email",
      )).rows,
    );
    for (const t of team) if (!recipients.includes(t.email)) recipients.push(t.email);
  }

  let queued = 0;
  const dedupeDate = now.toISOString().slice(0, 10);
  await withTenant(mspId, async (db) => {
    // Outbox rows need a user_id. For an external recipient the account owner
    // owns the send; removing the owner cascades their unsent mail with them.
    const owner = (await db.query<{ id: string }>(
      "select id from users where role = 'owner' order by created_at limit 1",
    )).rows[0];
    for (const email of recipients) {
      // Try to find a user id for this email so unsubscribe works for team members.
      const u = (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0];
      const userId = u?.id ?? owner?.id;
      if (!userId) continue;
      const unsub = u ? unsubscribeUrl(u.id, "weekly") : null;
      const mail = scheduledEmail({ mspName, frequency: row.frequency, report, reportUrl, unsubscribeUrl: unsub });
      const res = await db.query(
        `insert into outbox (msp_id, dedupe_key, kind, user_id, to_email, subject, body_text, body_html, unsubscribe_url)
         values ($1, $2, 'weekly', $3, $4, $5, $6, $7, $8)
         on conflict (dedupe_key) do nothing`,
        [
          mspId,
          `scheduled:${row.id}:${dedupeDate}:${email}`.slice(0, 300),
          userId,
          email,
          mail.subject.slice(0, 300),
          mail.text,
          mail.html,
          unsub ?? "",
        ],
      );
      if (res.rowCount === 1) queued++;
    }
  });

  await adminDb.query(
    `update report_schedules set last_run_at = $2, last_error = '', next_run_at = $3 where id = $1`,
    [row.id, now, nextRunAt(row.frequency, row.day_of_period, row.hour_utc, now)],
  );
  return queued;
}

/**
 * Fire every due schedule. Uses the admin connection (bypasses RLS) because
 * the scheduler is not scoped to one tenant. Each schedule's work still goes
 * through withTenant so RLS is enforced for the per-MSP writes.
 */
export async function runDueSchedules(adminUrl: string, now = new Date()): Promise<{ ran: number; queued: number }> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const due = (await client.query<Row & { msp_id: string }>(
      "select r.*, r.msp_id from report_schedules r where active and next_run_at <= $1 order by next_run_at limit 100",
      [now],
    )).rows;
    const mspNames = new Map<string, string>();
    for (const r of due) {
      if (!mspNames.has(r.msp_id)) {
        const n = (await client.query<{ name: string }>("select name from msps where id = $1", [r.msp_id])).rows[0];
        mspNames.set(r.msp_id, n?.name ?? "Zinloop Security");
      }
    }
    let queued = 0;
    for (const r of due) {
      try {
        queued += await runOne(client, r, r.msp_id, mspNames.get(r.msp_id) ?? "Zinloop Security", now);
      } catch (err) {
        await client.query(
          "update report_schedules set last_run_at = $2, last_error = $3, next_run_at = $4 where id = $1",
          [r.id, now, String((err as Error).message ?? err).slice(0, 500), nextRunAt(r.frequency, r.day_of_period, r.hour_utc, now)],
        );
      }
    }
    return { ran: due.length, queued };
  } finally {
    await client.end();
  }
}
