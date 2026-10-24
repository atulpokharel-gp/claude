// Made-up demo data for one MSP and six clients. No real companies or people.
// Laptop findings use the same rule IDs and wording as the scanner.

import type { Agent, Client, Finding } from "./types.ts";

export const MSP_NAME = "Harbor Managed IT";

const F = {
  secret: (where: string): Finding => ({
    ruleId: "SECRET_IN_CONFIG",
    severity: "high",
    title: "Credential stored in plain text",
    detail: `A long-lived key or token is written directly in the config file (${where}). Anyone or anything that can read this file, including other AI tools and malware, can reuse it.`,
    fix: "Move the value to the operating system's keychain or an environment variable, rotate the key, and give the replacement the smallest permissions it needs.",
  }),
  shell: (): Finding => ({
    ruleId: "SHELL_ACCESS",
    severity: "high",
    title: "Agent can run any command on this computer",
    detail:
      "This server gives the AI a terminal. A single malicious instruction hidden in an email, web page or file the agent reads could run commands with the user's full rights.",
    fix: "Remove it, or replace it with a server that only allows a short list of approved commands and asks before each run.",
  }),
  broadFs: (path: string): Finding => ({
    ruleId: "BROAD_FILESYSTEM",
    severity: "high",
    title: "Can read and write far more files than it needs",
    detail: `The filesystem server is allowed into ${path}. That covers documents, SSH keys, browser data and other apps' secrets.`,
    fix: "Limit it to the one project folder the agent needs, and use a read-only server where writing isn't required.",
  }),
  http: (host: string): Finding => ({
    ruleId: "INSECURE_TRANSPORT",
    severity: "high",
    title: "Unencrypted connection to a remote server",
    detail: `This server is reached over plain http at ${host}. Requests, responses and any tokens can be read or changed on the network.`,
    fix: "Switch the URL to https, or remove the server if the provider does not support it.",
  }),
  unpinned: (pkg: string): Finding => ({
    ruleId: "UNPINNED_PACKAGE",
    severity: "medium",
    title: "Downloads the newest code on every start",
    detail: `This server runs ${pkg} through npx without a fixed version. If the package is taken over or a bad update is published, it runs on this computer automatically.`,
    fix: `Pin an exact, reviewed version (for example ${pkg}@1.2.3) and update it on purpose.`,
  }),
  remote: (host: string): Finding => ({
    ruleId: "REMOTE_SERVER",
    severity: "low",
    title: "Sends data to an outside service",
    detail: `Whatever the agent passes to this server goes to ${host}.`,
    fix: "Confirm the company approves this provider and that a data agreement is in place.",
  }),
  mailAll: (): Finding => ({
    ruleId: "M365_MAIL_ALL",
    severity: "high",
    title: "Can read and send email as every user",
    detail:
      "This app holds the Mail.ReadWrite and Mail.Send application permissions for the whole tenant, so it can read any mailbox and send mail as anyone without a user signed in.",
    fix: "Revoke the grant, then re-add it with delegated permissions limited to the users who need it.",
  }),
  filesAll: (): Finding => ({
    ruleId: "M365_FILES_ALL",
    severity: "high",
    title: "Can read every file in SharePoint and OneDrive",
    detail:
      "This app holds Sites.Read.All and Files.Read.All for the whole tenant, which includes HR, finance and legal folders.",
    fix: "Revoke the grant and switch to Sites.Selected so it only reaches the sites it needs.",
  }),
  userConsent: (who: string): Finding => ({
    ruleId: "M365_USER_CONSENT",
    severity: "medium",
    title: "Added by a user without IT review",
    detail: `${who} approved this app's access on their own. No admin reviewed what it can reach.`,
    fix: "Review the permissions with the user, then either approve it as an admin or revoke it. Consider turning off user consent for unverified apps.",
  }),
  unverified: (): Finding => ({
    ruleId: "M365_UNVERIFIED_PUBLISHER",
    severity: "medium",
    title: "Publisher not verified by Microsoft",
    detail: "Microsoft has not confirmed who publishes this app, so it is hard to know who is behind it.",
    fix: "Confirm the vendor directly before keeping it, or replace it with a verified alternative.",
  }),
  noOwner: (who: string): Finding => ({
    ruleId: "M365_NO_OWNER",
    severity: "medium",
    title: "No one at the company owns this agent",
    detail: `This agent was built by ${who}, whose account is disabled. It still runs and still has access to its data sources.`,
    fix: "Assign a new owner who can confirm it is still needed, or turn it off.",
  }),
  orgWide: (source: string): Finding => ({
    ruleId: "M365_SHARED_ORG_WIDE",
    severity: "medium",
    title: "Shared with everyone in the company",
    detail: `Any employee can chat with this agent, and it answers from ${source}. People may see documents they could not open directly.`,
    fix: "Limit sharing to the team that needs it and check the permissions on its knowledge sources.",
  }),
  unused: (days: number): Finding => ({
    ruleId: "M365_UNUSED",
    severity: "low",
    title: `Not used in ${days} days but still has access`,
    detail: "Unused access is easy to forget and easy for an attacker to borrow.",
    fix: "Revoke it. It can be added back in a minute if someone still needs it.",
  }),
};

let n = 0;
const id = () => `a${++n}`;

function mcp(
  name: string,
  device: string,
  app: string,
  reach: string[],
  findings: Finding[],
  lastSeen = "2026-10-23",
): Agent {
  return { id: id(), name, kind: "mcp-server", source: "Laptop scan", location: device, app, reach, findings, revocable: false, lastSeen };
}

function m365(
  name: string,
  kind: "copilot-agent" | "oauth-app",
  owner: string,
  reach: string[],
  findings: Finding[],
  lastSeen = "2026-10-23",
): Agent {
  return {
    id: id(),
    name,
    kind,
    source: "Microsoft 365",
    location: owner,
    app: kind === "copilot-agent" ? "Copilot Studio" : "Enterprise app",
    reach,
    findings,
    revocable: true,
    lastSeen,
  };
}

export const clients: Client[] = [
  {
    id: "meridian-cu",
    name: "Meridian Credit Union",
    industry: "Financial services",
    staff: 650,
    devices: 712,
    devicesScanned: 688,
    lastScan: "2026-10-24T06:00:00Z",
    agents: [
      m365("InboxPilot AI", "oauth-app", "Added by r.alvarez", ["Every mailbox", "Send as any user"], [F.mailAll(), F.userConsent("r.alvarez (Loans)"), F.unverified()]),
      m365("Member FAQ Agent", "copilot-agent", "Owner: disabled account", ["Member policy SharePoint", "Teams chats"], [F.noOwner("j.chen, who left in August"), F.orgWide("the Member Policies site")]),
      m365("Loan Docs Summarizer", "copilot-agent", "Owner: k.patel", ["Loan files library"], [F.orgWide("the Loan Files library")]),
      mcp("github", "MCU-DEV-04", "Claude Desktop", ["GitHub repos (full access)"], [F.secret("env GITHUB_PERSONAL_ACCESS_TOKEN"), F.unpinned("@modelcontextprotocol/server-github")]),
      mcp("desktop-commander", "MCU-DEV-04", "Claude Desktop", ["Terminal", "All local files"], [F.shell()]),
      mcp("postgres", "MCU-DATA-02", "Cursor", ["Core banking replica DB"], [F.secret("env DATABASE_URL")]),
      mcp("sentry", "MCU-DEV-07", "Claude Code", ["Error logs"], [F.remote("mcp.sentry.dev")]),
      mcp("time", "MCU-OPS-11", "VS Code", ["Clock only"], []),
    ],
  },
  {
    id: "pinecrest-mfg",
    name: "Pinecrest Manufacturing",
    industry: "Manufacturing",
    staff: 1200,
    devices: 1340,
    devicesScanned: 905,
    lastScan: "2026-10-24T05:30:00Z",
    agents: [
      m365("DocuSift", "oauth-app", "Added by IT (2024)", ["All SharePoint sites", "All OneDrive files"], [F.filesAll(), F.unused(140)], "2026-06-06"),
      m365("Shop Floor Helper", "copilot-agent", "Owner: m.osei", ["Work instructions site"], []),
      mcp("filesystem", "PC-ENG-118", "Claude Desktop", ["Entire C: drive"], [F.broadFs("C:\\")]),
      mcp("plant-historian", "PC-ENG-122", "Cursor", ["OT historian (read)"], [F.http("historian.pinecrest.local:8080")]),
      mcp("playwright", "PC-ENG-118", "VS Code", ["Web browser"], [F.unpinned("@playwright/mcp")]),
    ],
  },
  {
    id: "oakridge-law",
    name: "Oakridge Law LLP",
    industry: "Legal",
    staff: 95,
    devices: 104,
    devicesScanned: 104,
    lastScan: "2026-10-24T04:45:00Z",
    agents: [
      m365("BriefMate", "oauth-app", "Added by s.novak", ["Matter files in OneDrive", "Calendar"], [F.userConsent("s.novak (Partner)"), F.unverified()]),
      m365("Clause Finder", "copilot-agent", "Owner: d.ferris", ["Precedents library"], [F.orgWide("the Precedents library, which includes sealed matters")]),
      mcp("notion", "OAK-LT-031", "Claude Desktop", ["Notion workspace"], [F.remote("mcp.notion.com")]),
    ],
  },
  {
    id: "cascade-freight",
    name: "Cascade Freight",
    industry: "Logistics",
    staff: 420,
    devices: 380,
    devicesScanned: 361,
    lastScan: "2026-10-24T05:10:00Z",
    agents: [
      m365("Dispatch Copilot", "copilot-agent", "Owner: t.hughes", ["Dispatch schedules", "Driver contacts"], []),
      mcp("stripe", "CF-FIN-03", "Claude Code", ["Payments (full)"], [F.secret("env STRIPE_SECRET_KEY")]),
      mcp("linear", "CF-DEV-01", "Cursor", ["Issue tracker"], [F.remote("mcp.linear.app")]),
      mcp("browser-use", "CF-OPS-09", "Claude Desktop", ["Web browser"], [F.unpinned("browser-use-mcp")]),
    ],
  },
  {
    id: "brightline-dental",
    name: "Brightline Dental Group",
    industry: "Healthcare",
    staff: 180,
    devices: 210,
    devicesScanned: 196,
    lastScan: "2026-10-24T04:20:00Z",
    agents: [
      m365("Front Desk Assistant", "copilot-agent", "Owner: l.burke", ["Scheduling site"], [F.unused(95)], "2026-07-21"),
      mcp("google-drive", "BDG-ADMIN-02", "Claude Desktop", ["Google Drive"], [F.remote("mcp.gdrive.example")]),
    ],
  },
  {
    id: "summit-architects",
    name: "Summit Architects",
    industry: "Professional services",
    staff: 60,
    devices: 72,
    devicesScanned: 72,
    lastScan: "2026-10-24T03:55:00Z",
    agents: [mcp("figma", "SUM-MAC-07", "Claude Desktop", ["Figma files"], [])],
  },
];

export function getClient(id: string): Client | undefined {
  return clients.find((c) => c.id === id);
}
