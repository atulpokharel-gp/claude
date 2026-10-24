// Shared shapes for the console. Severity and Finding match the scanner's JSON.

export type Severity = "high" | "medium" | "low" | "none";

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
}

export type AgentKind = "mcp-server" | "copilot-agent" | "oauth-app";

/** A person linked to an agent: a laptop profile or a Microsoft 365 user. */
export interface PersonRef {
  /** Matching key within one client: the laptop profile name or the part of the sign-in email before @, lowercased. */
  key: string;
  /** What to show: a Microsoft 365 display name, or the laptop profile name. */
  name: string;
  /** Sign-in email, for Microsoft 365 users. */
  email?: string;
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  /** Where we learned about it. */
  source: "Laptop scan" | "Microsoft 365";
  /** Device name for laptop finds, or the tenant/app owner for Microsoft 365 finds. */
  location: string;
  /** App that hosts it, e.g. "Claude Desktop", "Copilot Studio". */
  app: string;
  /** Short list of what it can reach, in plain words. */
  reach: string[];
  findings: Finding[];
  /** True when the console could cut off access with one click (Microsoft 365 grants). */
  revocable: boolean;
  lastSeen: string; // ISO date
  /** People who use it or gave it access. Empty for tools approved for everyone. */
  people?: PersonRef[];
  /** Env vars Zinloop moved into the computer's password store. */
  protectedKeys?: string[];
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  staff: number;
  devices: number;
  devicesScanned: number;
  lastScan: string; // ISO date-time
  agents: Agent[];
  /** Problems that make the picture incomplete, such as config files the scanner couldn't read. */
  warnings?: string[];
}

export interface RiskCounts {
  high: number;
  medium: number;
  low: number;
  none: number;
  total: number;
}
