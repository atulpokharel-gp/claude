// Pure tests for the scheduler: next-run calculation and email body.
// The database-backed path (setSchedule, runDueSchedules) runs in lib/db.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { nextRunAt, scheduledEmail } from "./schedules.ts";
import type { ClientReport } from "./report.ts";

describe("schedules: nextRunAt", () => {
  test("weekly picks the next weekday at the chosen hour", () => {
    // Monday 2026-10-26T05:00:00Z. Weekday is 1 (Monday).
    const now = new Date("2026-10-26T05:00:00Z");
    // Want: next Thursday (4) at 13:00 UTC -> 2026-10-29T13:00:00Z.
    const next = nextRunAt("weekly", 4, 13, now);
    assert.equal(next.toISOString(), "2026-10-29T13:00:00.000Z");
  });

  test("weekly rolls to next week if today has passed", () => {
    const now = new Date("2026-10-26T20:00:00Z"); // Monday 20:00
    const next = nextRunAt("weekly", 1, 13, now); // Monday 13:00
    assert.equal(next.toISOString(), "2026-11-02T13:00:00.000Z");
  });

  test("monthly rolls to next month when the date has passed", () => {
    const now = new Date("2026-10-15T20:00:00Z");
    const next = nextRunAt("monthly", 1, 9, now);
    assert.equal(next.toISOString(), "2026-11-01T09:00:00.000Z");
  });

  test("monthly day is clamped to [1, 28]", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const next = nextRunAt("monthly", 99, 9, now); // Clamp to 28
    assert.equal(next.toISOString(), "2026-02-28T09:00:00.000Z");
  });
});

describe("schedules: scheduledEmail", () => {
  const report: ClientReport = {
    clientName: "Acme <Pear>",
    preparedBy: "Zinloop Security",
    date: "2026-10-25",
    headline: "We found 3 AI tools connected to company systems. 2 need action now.",
    tools: 3,
    high: 2,
    medium: 1,
    plainKeys: 1,
    keysProtected: 2,
    laptopsReporting: 8,
    laptopsExpected: 10,
    m365Apps: 1,
    actions: [
      { ruleId: "SECRET_IN_CONFIG", severity: "high", title: "Plain-text API key in Claude Desktop", fix: "Rotate", tools: 1, places: ["LAPTOP-1"] },
      { ruleId: "M365_ORG_WIDE_GRANT", severity: "high", title: "App approved for everyone", fix: "Revoke", tools: 1, places: ["Microsoft 365 · Otter"] },
      { ruleId: "KEY_NOT_ROTATED", severity: "medium", title: "Key not rotated", fix: "Rotate", tools: 1, places: ["LAPTOP-2"] },
    ],
    clean: [],
    warnings: [],
  };

  test("includes severities and escapes HTML", () => {
    const mail = scheduledEmail({
      mspName: "Zinloop Security",
      frequency: "weekly",
      report,
      reportUrl: "https://zinloop.com/app/clients/x/report",
      unsubscribeUrl: null,
    });
    assert.match(mail.subject, /^Weekly AI security report:/);
    // Client name < > must be escaped in HTML
    assert.ok(!mail.html.includes("Acme <Pear>"));
    assert.ok(mail.html.includes("Acme &lt;Pear&gt;"));
    // All three top actions appear in text
    assert.ok(mail.text.includes("Plain-text API key"));
    assert.ok(mail.text.includes("App approved for everyone"));
  });

  test("monthly subject differs from weekly", () => {
    const w = scheduledEmail({ mspName: "A", frequency: "weekly", report, reportUrl: null, unsubscribeUrl: null });
    const m = scheduledEmail({ mspName: "A", frequency: "monthly", report, reportUrl: null, unsubscribeUrl: null });
    assert.match(w.subject, /^Weekly/);
    assert.match(m.subject, /^Monthly/);
  });

  test("unsubscribe link lands in HTML and text when given", () => {
    const mail = scheduledEmail({
      mspName: "A", frequency: "weekly", report, reportUrl: null,
      unsubscribeUrl: "https://zinloop.com/unsubscribe?t=xyz",
    });
    assert.ok(mail.text.includes("https://zinloop.com/unsubscribe?t=xyz"));
    assert.ok(mail.html.includes("https://zinloop.com/unsubscribe?t=xyz"));
  });
});
