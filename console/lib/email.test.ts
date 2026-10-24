import { test } from "node:test";
import assert from "node:assert/strict";
import { alertEmail, clientWeeklyEmail, esc, oneLine, weeklyEmail } from "./email.ts";
import { highRiskFindings, weekOf } from "./alerts.ts";
import type { Agent, Client } from "./types.ts";

test("names from scans can't inject HTML or break the subject line", () => {
  const m = alertEmail({
    mspName: "Acme IT",
    clientName: "Evil\r\nBcc: x@y.example Co",
    findings: [{ tool: "<script>alert(1)</script>", title: "Key in plain text", place: "Cursor · LAPTOP-1" }],
    clientUrl: "https://app.example/app/clients/1",
    unsubscribeUrl: "https://app.example/unsubscribe?t=a&b",
    settingsUrl: null,
  });
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.subject, /^New high-risk AI tool at Evil Bcc: x@y\.example Co: /);
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.ok(m.html.includes("t=a&amp;b"));
  assert.match(m.text, /Stop these emails: https:\/\/app\.example\/unsubscribe\?t=a&b/);
  assert.equal(esc(`"'&`), "&quot;&#39;&amp;");
  assert.equal(oneLine("a\u0000b\tc"), "a b c");
});

test("alert emails count findings and cap the list", () => {
  const findings = Array.from({ length: 25 }, (_, i) => ({ tool: `tool${i}`, title: "Runs any command", place: "x" }));
  const m = alertEmail({ mspName: "Acme IT", clientName: "Contoso", findings, clientUrl: null, unsubscribeUrl: null, settingsUrl: null });
  assert.equal(m.subject, "25 new high-risk AI tool problems at Contoso");
  assert.match(m.text, /and 5 more/);
  assert.match(m.text, /Open the Zinloop console/);
});

test("the weekly summary adds up clients and lists the riskiest first", () => {
  const m = weeklyEmail({
    mspName: "Acme IT",
    weekOf: "October 19, 2026",
    clients: [
      { name: "Quiet Co", high: 0, medium: 1, highChange: 0, newHigh: 0 },
      { name: "Risky Co", high: 3, medium: 0, highChange: 2, newHigh: 2 },
    ],
    attention: ["Risky Co: 3 high-risk tools"],
    consoleUrl: "https://app.example/app",
    unsubscribeUrl: null,
    settingsUrl: "https://app.example/app/settings",
  });
  assert.equal(m.subject, "Weekly AI security summary: 3 high-risk tools across 2 clients");
  assert.match(m.text, /High risk: 3 \(up 2 this week\)/);
  assert.ok(m.text.indexOf("Risky Co: 3") < m.text.indexOf("Quiet Co: 0"));
  assert.match(m.text, /Change email settings: https:\/\/app\.example\/app\/settings/);
  const c = clientWeeklyEmail({
    mspName: "Acme IT", clientName: "Contoso", weekOf: "October 19, 2026", high: 0, medium: 2, highChange: -1,
    newHigh: [], laptopsReporting: 4, laptopsExpected: 5, portalUrl: null, unsubscribeUrl: null, settingsUrl: null,
  });
  assert.match(c.text, /No high-risk AI tools were found this week/);
  assert.match(c.text, /4 of 5/);
});

test("weeks start on Monday (UTC)", () => {
  assert.equal(weekOf(new Date("2026-10-24T12:00:00Z")), "2026-10-19"); // Saturday
  assert.equal(weekOf(new Date("2026-10-19T00:00:00Z")), "2026-10-19"); // Monday
  assert.equal(weekOf(new Date("2026-10-25T23:59:00Z")), "2026-10-19"); // Sunday
});

test("high-risk findings are keyed by tool, rule and place", () => {
  const agent = (name: string, location: string, sev: "high" | "medium"): Agent => ({
    id: name, name, kind: "mcp-server", source: "Laptop scan", location, app: "Cursor", reach: [], revocable: false, lastSeen: "",
    findings: [{ ruleId: "SHELL_ACCESS", severity: sev, title: "Runs any command", detail: "", fix: "" }],
  });
  const client = { agents: [agent("Commander", "L1", "high"), agent("commander", "L1", "high"), agent("Commander", "L2", "high"), agent("Files", "L1", "medium")] } as Client;
  assert.deepEqual([...highRiskFindings(client).keys()], ["commander|SHELL_ACCESS|L1", "commander|SHELL_ACCESS|L2"]);
  // Microsoft 365 apps are keyed by their ID: a changing user count in the location isn't a new problem.
  const m365 = (users: number): Agent => ({ ...agent("Notes Bot", `Acme Microsoft 365 · ${users} users`, "high"), id: "m365-sp-notes", source: "Microsoft 365" });
  assert.deepEqual([...highRiskFindings({ agents: [m365(0)] } as Client).keys()], [...highRiskFindings({ agents: [m365(3)] } as Client).keys()]);
});
