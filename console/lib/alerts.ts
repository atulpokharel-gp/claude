// Who gets which email. New high-risk findings are emailed to the MSP team once
// each; the weekly summary goes to the team and to client viewers. Emails go
// into the outbox and scripts/send-mail.ts delivers them.

import { createHash } from "node:crypto";
import { hasAppSecret, sign } from "./crypto.ts";
import { withTenant, type Db } from "./db.ts";
import { alertEmail, clientWeeklyEmail, weeklyEmail, type AlertFinding, type Email } from "./email.ts";
import { attention, snapshotOf, toolKey } from "./insights.ts";
import { getClient, getTrend, listClients } from "./store.ts";
import type { Client } from "./types.ts";

export type EmailKind = "alert" | "weekly";

/** Unsubscribe links last a year. */
const UNSUBSCRIBE_SECONDS = 365 * 86_400;

export function consoleBase(): string | null {
  const u = process.env.CONSOLE_URL?.trim();
  return u ? u.replace(/\/+$/, "") : null;
}

export function unsubscribeUrl(userId: string, kind: EmailKind): string | null {
  const base = consoleBase();
  if (!base || !hasAppSecret()) return null;
  return `${base}/unsubscribe?t=${encodeURIComponent(sign("unsub", { u: userId, k: kind }, UNSUBSCRIBE_SECONDS))}`;
}

/**
 * Each high-risk finding at a client, keyed so the same problem is recognized
 * on the next scan: by device and config path for laptop finds, and by the
 * app's stable ID for Microsoft 365 apps (their location text includes a user
 * count that changes).
 */
export function highRiskFindings(client: Client): Map<string, AlertFinding> {
  const out = new Map<string, AlertFinding>();
  for (const a of client.agents) {
    for (const f of a.findings) {
      if (f.severity !== "high") continue;
      const where = a.source === "Microsoft 365" ? a.id : a.location;
      const key = `${toolKey(a.name)}|${f.ruleId}|${where}`.slice(0, 600);
      if (!out.has(key)) out.set(key, { tool: a.name, title: f.title, place: `${a.app} · ${a.location}` });
    }
  }
  return out;
}

interface Recipient {
  id: string;
  email: string;
}

async function enqueue(db: Db, mspId: string, dedupeKey: string, kind: EmailKind, to: Recipient, mail: Email, unsubscribe: string | null): Promise<boolean> {
  const res = await db.query(
    `insert into outbox (msp_id, dedupe_key, kind, user_id, to_email, subject, body_text, body_html, unsubscribe_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (dedupe_key) do nothing`,
    [mspId, dedupeKey.slice(0, 300), kind, to.id, to.email, mail.subject.slice(0, 300), mail.text, mail.html, unsubscribe ?? ""],
  );
  return res.rowCount === 1;
}

/**
 * Emails the MSP team about high-risk findings at a client that haven't been
 * seen before. Called after each scan upload and Microsoft 365 check. Never
 * throws: a failed alert must not fail the upload. Returns emails queued.
 */
export async function checkAlerts(mspId: string, clientId: string, now = new Date()): Promise<number> {
  try {
    const got = await getClient(mspId, clientId, now);
    if (!got) return 0;
    const current = highRiskFindings(got.client);
    if (current.size === 0) return 0;
    return await withTenant(mspId, async (db) => {
      // Only the request that records a finding first sends its alert, so two
      // uploads at once don't email twice.
      const inserted = (
        await db.query<{ key: string }>(
          `insert into seen_findings (client_id, msp_id, key, first_seen)
           select $1, $2, k, $4 from unnest($3::text[]) as k
           on conflict (client_id, key) do nothing returning key`,
          [clientId, mspId, [...current.keys()], now],
        )
      ).rows.map((r) => r.key);
      if (inserted.length === 0) return 0;
      const findings = inserted.sort().map((k) => current.get(k)!);
      const batch = createHash("sha256").update(inserted.join("\n")).digest("hex").slice(0, 16);
      const mspName = (await db.query<{ name: string }>("select name from msps")).rows[0]?.name ?? "";
      const people = (
        await db.query<Recipient>("select id, email from users where role in ('owner', 'member') and alert_emails order by created_at")
      ).rows;
      const base = consoleBase();
      let n = 0;
      for (const p of people) {
        const unsub = unsubscribeUrl(p.id, "alert");
        const mail = alertEmail({
          mspName,
          clientName: got.client.name,
          findings,
          clientUrl: base && `${base}/app/clients/${clientId}`,
          unsubscribeUrl: unsub,
          settingsUrl: base && `${base}/app/settings`,
        });
        if (await enqueue(db, mspId, `alert:${clientId}:${batch}:${p.id}`, "alert", p, mail, unsub)) n++;
      }
      return n;
    });
  } catch (err) {
    console.error(`alert check for client ${clientId} failed: ${(err as Error).message}`);
    return 0;
  }
}

/** Monday of the week `now` is in, as YYYY-MM-DD (UTC). */
export function weekOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function longDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Queues this week's summary for everyone at one MSP who wants it. Safe to run
 * every day: each person gets one per week. Returns emails queued.
 */
export async function queueWeekly(mspId: string, now = new Date()): Promise<number> {
  const clients = await listClients(mspId, now);
  if (clients.length === 0) return 0;
  const week = weekOf(now);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const trends = new Map<string, number>();
  for (const c of clients) {
    const t = await getTrend(mspId, 8, now, c.id);
    trends.set(c.id, t[t.length - 1].high - t[0].high);
  }
  const base = consoleBase();
  return withTenant(mspId, async (db) => {
    const mspName = (await db.query<{ name: string }>("select name from msps")).rows[0]?.name ?? "";
    const fresh = (
      await db.query<{ client_id: string; key: string }>("select client_id, key from seen_findings where first_seen >= $1", [since])
    ).rows;
    const newByClient = new Map<string, Set<string>>();
    for (const r of fresh) {
      if (!newByClient.has(r.client_id)) newByClient.set(r.client_id, new Set());
      newByClient.get(r.client_id)!.add(r.key);
    }
    const rows = clients.map((c) => {
      const s = snapshotOf(c);
      return { id: c.id, name: c.name, high: s.high, medium: s.medium, highChange: trends.get(c.id) ?? 0, newHigh: newByClient.get(c.id)?.size ?? 0 };
    });
    const att = attention(clients, now).map((a) => `${a.clientName}: ${a.text}`);
    const users = (
      await db.query<Recipient & { role: string; client_id: string | null }>(
        "select id, email, role, client_id from users where weekly_email order by created_at",
      )
    ).rows;
    let n = 0;
    for (const u of users) {
      const unsub = unsubscribeUrl(u.id, "weekly");
      let mail: Email;
      if (u.role === "viewer") {
        const c = clients.find((x) => x.id === u.client_id);
        const row = rows.find((x) => x.id === u.client_id);
        if (!c || !row) continue;
        const found = highRiskFindings(c);
        mail = clientWeeklyEmail({
          mspName,
          clientName: c.name,
          weekOf: longDay(week),
          high: row.high,
          medium: row.medium,
          highChange: row.highChange,
          newHigh: [...(newByClient.get(c.id) ?? [])].map((k) => found.get(k)).filter((x): x is AlertFinding => Boolean(x)),
          laptopsReporting: c.devicesScanned,
          laptopsExpected: c.devices,
          portalUrl: base && `${base}/portal`,
          unsubscribeUrl: unsub,
          settingsUrl: base && `${base}/portal/account`,
        });
      } else {
        mail = weeklyEmail({
          mspName,
          weekOf: longDay(week),
          clients: rows,
          attention: att,
          consoleUrl: base && `${base}/app`,
          unsubscribeUrl: unsub,
          settingsUrl: base && `${base}/app/settings`,
        });
      }
      if (await enqueue(db, mspId, `weekly:${week}:${u.id}`, "weekly", u, mail, unsub)) n++;
    }
    return n;
  });
}
