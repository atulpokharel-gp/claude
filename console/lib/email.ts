// Email contents: alerts for new high-risk AI tools and the weekly summaries.
// Pure functions; lib/alerts.ts decides who gets what, scripts/send-mail.ts sends.

export interface Email {
  subject: string;
  text: string;
  html: string;
}

/** Escapes text for HTML. Every value from a scan or a user goes through this. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One line, no control characters, so a client or tool name can't break the subject header. */
export function oneLine(s: string, max = 200): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function change(n: number): string {
  return n > 0 ? `up ${n}` : n < 0 ? `down ${-n}` : "no change";
}

function page(title: string, body: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e5ea;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#5b6475">Zinloop Security</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(title)}</h1>
${body}
</td></tr></table>
<p style="max-width:600px;margin:12px auto 0;font-size:12px;color:#5b6475;line-height:1.5">${footer}</p>
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0 0"><a href="${esc(href)}" style="display:inline-block;background:#0f6e6e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">${esc(label)}</a></p>`;
}

function footer(reason: string, unsubscribeUrl: string | null, settingsUrl: string | null): { html: string; text: string } {
  const how = unsubscribeUrl ? "Stop these emails" : settingsUrl ? "Change email settings" : "";
  const href = unsubscribeUrl ?? settingsUrl;
  return {
    html: `${esc(reason)}${href ? ` <a href="${esc(href)}" style="color:#5b6475">${how}</a>.` : ""}`,
    text: `${reason}${href ? `\n${how}: ${href}` : ""}`,
  };
}

export interface AlertFinding {
  tool: string;
  title: string;
  place: string;
}

export function alertEmail(o: {
  mspName: string;
  clientName: string;
  findings: AlertFinding[];
  clientUrl: string | null;
  unsubscribeUrl: string | null;
  settingsUrl: string | null;
}): Email {
  const n = o.findings.length;
  const client = oneLine(o.clientName);
  const subject = n === 1 ? `New high-risk AI tool at ${client}: ${oneLine(o.findings[0].tool, 80)}` : `${n} new high-risk AI tool problems at ${client}`;
  const shown = o.findings.slice(0, 20);
  const more = n - shown.length;
  const f = footer(`You get this because you're on the ${o.mspName} team and alerts are on.`, o.unsubscribeUrl, o.settingsUrl);
  const text = [
    `Zinloop found ${plural(n, "new high-risk problem")} with AI tools at ${client}:`,
    "",
    ...shown.map((x) => `- ${oneLine(x.tool, 120)}: ${oneLine(x.title, 200)} (${oneLine(x.place, 200)})`),
    ...(more > 0 ? [`- and ${more} more`] : []),
    "",
    o.clientUrl ? `See details and fixes: ${o.clientUrl}` : "Open the Zinloop console for details and fixes.",
    "",
    "--",
    f.text,
  ].join("\n");
  const rows = shown
    .map(
      (x) => `<tr><td style="padding:8px 0;border-top:1px solid #e2e5ea"><b>${esc(oneLine(x.tool, 120))}</b><br>
<span style="color:#b42318">${esc(oneLine(x.title, 200))}</span><br><span style="font-size:13px;color:#5b6475">${esc(oneLine(x.place, 200))}</span></td></tr>`,
    )
    .join("");
  const body = `<p style="margin:0 0 12px;line-height:1.5">Zinloop found ${esc(plural(n, "new high-risk problem"))} with AI tools at <b>${esc(client)}</b>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
${more > 0 ? `<p style="margin:8px 0 0;color:#5b6475">and ${more} more</p>` : ""}
${o.clientUrl ? button(o.clientUrl, "See details and fixes") : ""}`;
  return { subject, text, html: page(subject, body, f.html) };
}

export interface WeeklyClientRow {
  name: string;
  high: number;
  medium: number;
  /** Change in high-risk tools over the week. */
  highChange: number;
  newHigh: number;
}

export function weeklyEmail(o: {
  mspName: string;
  weekOf: string;
  clients: WeeklyClientRow[];
  attention: string[];
  consoleUrl: string | null;
  unsubscribeUrl: string | null;
  settingsUrl: string | null;
}): Email {
  const high = o.clients.reduce((s, c) => s + c.high, 0);
  const medium = o.clients.reduce((s, c) => s + c.medium, 0);
  const newHigh = o.clients.reduce((s, c) => s + c.newHigh, 0);
  const highChange = o.clients.reduce((s, c) => s + c.highChange, 0);
  const subject = `Weekly AI security summary: ${plural(high, "high-risk tool")} across ${plural(o.clients.length, "client")}`;
  const rows = [...o.clients].sort((a, b) => b.high - a.high || b.medium - a.medium || a.name.localeCompare(b.name));
  const shown = rows.slice(0, 25);
  const f = footer(`You get this every week because you're on the ${o.mspName} team.`, o.unsubscribeUrl, o.settingsUrl);
  const text = [
    `Week of ${o.weekOf}`,
    "",
    `High risk: ${high} (${change(highChange)} this week)`,
    `Medium risk: ${medium}`,
    `New high-risk problems found this week: ${newHigh}`,
    "",
    ...(o.attention.length ? ["Needs attention:", ...o.attention.slice(0, 8).map((a) => `- ${oneLine(a, 300)}`), ""] : []),
    "By client (high / medium / change):",
    ...shown.map((c) => `- ${oneLine(c.name, 120)}: ${c.high} / ${c.medium} / ${change(c.highChange)}`),
    ...(rows.length > shown.length ? [`- and ${rows.length - shown.length} more clients`] : []),
    "",
    o.consoleUrl ? `Open the console: ${o.consoleUrl}` : "",
    "--",
    f.text,
  ].join("\n");
  const stat = (n: number | string, label: string, bad = false) =>
    `<td style="padding:8px;border:1px solid #e2e5ea;border-radius:6px;width:33%"><div style="font-size:22px;font-weight:700;${bad ? "color:#b42318" : ""}">${esc(String(n))}</div><div style="font-size:13px;color:#5b6475">${esc(label)}</div></td>`;
  const body = `<p style="margin:0 0 12px;color:#5b6475">Week of ${esc(o.weekOf)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${stat(high, `high risk (${change(highChange)})`, high > 0)}${stat(medium, "medium risk")}${stat(newHigh, "new high-risk this week", newHigh > 0)}
</tr></table>
${
  o.attention.length
    ? `<h2 style="font-size:16px;margin:20px 0 8px">Needs attention</h2><ul style="margin:0;padding-left:20px;line-height:1.6">${o.attention
        .slice(0, 8)
        .map((a) => `<li>${esc(oneLine(a, 300))}</li>`)
        .join("")}</ul>`
    : ""
}
<h2 style="font-size:16px;margin:20px 0 8px">By client</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
<tr style="color:#5b6475;text-align:left"><th style="padding:6px 0">Client</th><th>High</th><th>Medium</th><th>This week</th></tr>
${shown
  .map(
    (c) =>
      `<tr><td style="padding:6px 0;border-top:1px solid #e2e5ea">${esc(oneLine(c.name, 120))}</td><td style="border-top:1px solid #e2e5ea;${c.high ? "color:#b42318;font-weight:600" : ""}">${c.high}</td><td style="border-top:1px solid #e2e5ea">${c.medium}</td><td style="border-top:1px solid #e2e5ea">${esc(change(c.highChange))}</td></tr>`,
  )
  .join("")}
</table>
${rows.length > shown.length ? `<p style="margin:8px 0 0;color:#5b6475">and ${rows.length - shown.length} more clients</p>` : ""}
${o.consoleUrl ? button(o.consoleUrl, "Open the console") : ""}`;
  return { subject, text: text.replace(/\n{3,}/g, "\n\n"), html: page("Your weekly AI security summary", body, f.html) };
}

export interface ChangeRow {
  device: string;
  what: string; // e.g. "New AI tool: GitHub (Cursor)", "Risky config returned: shell access"
}

/** Short email: an AI tool appeared, permissions changed, or a risk returned. */
export function changesEmail(o: {
  mspName: string;
  clientName: string;
  added: ChangeRow[];
  changed: ChangeRow[];
  returned: ChangeRow[];
  clientUrl: string | null;
  unsubscribeUrl: string | null;
  settingsUrl: string | null;
}): Email {
  const client = oneLine(o.clientName);
  const total = o.added.length + o.changed.length + o.returned.length;
  const headline =
    o.returned.length > 0 && o.added.length === 0 && o.changed.length === 0
      ? `A risky AI config came back at ${client}`
      : o.added.length > 0 && o.changed.length === 0 && o.returned.length === 0
        ? `${plural(o.added.length, "new AI tool")} at ${client}`
        : `${plural(total, "change")} to AI tools at ${client}`;
  const subject = oneLine(headline);
  const section = (title: string, rows: ChangeRow[]): { text: string; html: string } => {
    if (rows.length === 0) return { text: "", html: "" };
    const shown = rows.slice(0, 10);
    const more = rows.length - shown.length;
    return {
      text: [`${title}:`, ...shown.map((r) => `- ${oneLine(r.device, 100)}: ${oneLine(r.what, 240)}`), ...(more > 0 ? [`- and ${more} more`] : []), ""].join("\n"),
      html: `<h2 style="font-size:15px;margin:16px 0 6px">${esc(title)}</h2><ul style="margin:0;padding-left:20px;line-height:1.6">${shown
        .map((r) => `<li><b>${esc(oneLine(r.device, 100))}</b>: ${esc(oneLine(r.what, 240))}</li>`)
        .join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>`,
    };
  };
  const sNew = section("New AI tools", o.added);
  const sChanged = section("Changed permissions", o.changed);
  const sReturned = section("Risky configs that came back", o.returned);
  const f = footer(`You get this because you're on the ${o.mspName} team and alerts are on.`, o.unsubscribeUrl, o.settingsUrl);
  const text = [
    headline,
    "",
    sNew.text,
    sChanged.text,
    sReturned.text,
    o.clientUrl ? `See the details: ${o.clientUrl}` : "",
    "--",
    f.text,
  ].join("\n");
  const body = `<p style="margin:0 0 12px;line-height:1.5;font-size:16px">${esc(headline)}</p>${sNew.html}${sChanged.html}${sReturned.html}${o.clientUrl ? button(o.clientUrl, "See the details") : ""}`;
  return { subject, text: text.replace(/\n{3,}/g, "\n\n"), html: page(subject, body, f.html) };
}

export function clientWeeklyEmail(o: {
  mspName: string;
  clientName: string;
  weekOf: string;
  high: number;
  medium: number;
  highChange: number;
  newHigh: AlertFinding[];
  laptopsReporting: number;
  laptopsExpected: number;
  portalUrl: string | null;
  unsubscribeUrl: string | null;
  settingsUrl: string | null;
}): Email {
  const client = oneLine(o.clientName);
  const subject = `${client}: weekly AI security summary`;
  const f = footer(`You get this every week because ${o.mspName} gave you a login to see ${client}'s results.`, o.unsubscribeUrl, o.settingsUrl);
  const headline =
    o.high === 0 ? "No high-risk AI tools were found this week." : `${plural(o.high, "AI tool")} at high risk (${change(o.highChange)} this week). ${o.mspName} is working on them.`;
  const text = [
    `Week of ${o.weekOf}`,
    "",
    headline,
    `Medium risk: ${o.medium}`,
    `Laptops checked this week: ${o.laptopsReporting} of ${o.laptopsExpected}`,
    ...(o.newHigh.length ? ["", "Found this week:", ...o.newHigh.slice(0, 10).map((x) => `- ${oneLine(x.tool, 120)}: ${oneLine(x.title, 200)}`)] : []),
    "",
    o.portalUrl ? `See the full report: ${o.portalUrl}` : "",
    "--",
    f.text,
  ].join("\n");
  const body = `<p style="margin:0 0 12px;color:#5b6475">Week of ${esc(o.weekOf)}</p>
<p style="margin:0 0 12px;line-height:1.5;font-size:16px">${esc(headline)}</p>
<p style="margin:0;line-height:1.6">Medium risk: <b>${o.medium}</b><br>Laptops checked this week: <b>${o.laptopsReporting} of ${o.laptopsExpected}</b></p>
${
  o.newHigh.length
    ? `<h2 style="font-size:16px;margin:20px 0 8px">Found this week</h2><ul style="margin:0;padding-left:20px;line-height:1.6">${o.newHigh
        .slice(0, 10)
        .map((x) => `<li><b>${esc(oneLine(x.tool, 120))}</b>: ${esc(oneLine(x.title, 200))}</li>`)
        .join("")}</ul>`
    : ""
}
${o.portalUrl ? button(o.portalUrl, "See the full report") : ""}`;
  return { subject, text: text.replace(/\n{3,}/g, "\n\n"), html: page(subject, body, f.html) };
}
