// Browser-side checker for AI connector (MCP server) configs, used by the
// free public checker at /check. It mirrors the laptop scanner's rules in
// scanner/internal/rules/rules.go so a pasted config gets the same findings.
// It runs entirely in the visitor's browser: nothing here touches the network.
//
// Keep the two in step: when a rule changes in Go, change it here and add the
// same case to mcp-check.test.ts.

export type Severity = "high" | "medium" | "low" | "none";
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface CheckFinding {
  ruleId: string;
  severity: Exclude<Severity, "none">;
  title: string;
  detail: string;
  fix: string;
}

export interface CheckServer {
  name: string;
  scope?: string;
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface CheckedServer {
  name: string;
  scope?: string;
  kind: "local" | "remote";
  findings: CheckFinding[];
}

export interface CheckResult {
  servers: CheckedServer[];
  counts: { high: number; medium: number; low: number };
  score: number;
  grade: Grade;
  /** Entries that weren't objects and so weren't checked. */
  skipped: string[];
}

export class ConfigError extends Error {}

const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1, none: 0 };

const secretKeyName = /(token|secret|passw|api[_-]?key|access[_-]?key|private[_-]?key|credential|\bpat\b|_pat$)/i;
const secretValueSrc =
  "(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_\\-]{20,}|sk-ant-[A-Za-z0-9_\\-]{20,}|xox[abprs]-[A-Za-z0-9\\-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\\-]{30,}|glpat-[A-Za-z0-9_\\-]{20,}|[Bb][Ee][Aa][Rr][Ee][Rr]\\s+[A-Za-z0-9._\\-]{16,})";
const secretValue = new RegExp(secretValueSrc);
const secretValueAll = new RegExp(secretValueSrc, "g");
const reference = /^\$\{[^}]+\}$|^\$[A-Za-z_][A-Za-z0-9_]*$|^\$\{(env|input):[^}]+\}$|^op:\/\/|^keychain:/;
const pkgVersion = /^(@[^/]+\/)?[^@]+@(.+)$/;
const shellServer = /(desktop-commander|mcp-shell|shell-server|server-shell|mcp-server-commands|terminal-mcp|mcp-terminal|run-command|code-runner)/i;
const fsServer = /filesystem/i;
const npmExactVersion = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const pyExactVersion = /^\d+(\.\d+)*([a-zA-Z0-9.+-]*)$/;
// Zero-width and bidi-override characters. See rules.go for background.
const hiddenChars = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const injectionPhrase =
  /(ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)|disregard\s+(the\s+|all\s+)?(above|previous|system|prior)\s+(instructions|prompts?)|forget\s+(all\s+|your\s+|the\s+)?(previous|prior|earlier)\s+(instructions|prompts?|rules)|override\s+(your|the|all)\s+(instructions|rules|prompts?)|reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)|print\s+(your|the)\s+(system\s+)?prompt|you\s+are\s+(now\s+)?dan\b|do\s+anything\s+now)/i;
const broadOAuthScope =
  /(^|[,\s])(\*|admin(:[^,\s]+)?|admin[._-](all|org|user|repo)|write:all|write[._-]all|write:org|full[_-]?access|full[_-]?control|offline_access|read:all|read[._-]all|read:org|user:all|repo$|repo:[^,\s]+|workspace:all|all:all|owner|superuser|root|dangerously[_-]skip[_-]permissions)(?=$|[,\s])/i;
const trustedNpmHost = /^(registry\.npmjs\.org|npm\.pkg\.github\.com)$/;
const trustedPyHost = /^(pypi\.org|files\.pythonhosted\.org)$/;
const untrustedSourcePrefix = /^(git\+|git:\/\/|git@|https?:\/\/|file:|\.\/|\.\\|\/|~|[A-Za-z]:[\\/])/;

// ---------- parsing ----------

/** Removes // and /* *\/ comments and trailing commas (JSON with comments). */
export function stripJsonc(input: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      if (i < input.length) out += "\n";
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i + 1 < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  // Trailing commas, outside strings.
  let res = "";
  inStr = false;
  esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      res += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    if (c === ",") {
      let j = i + 1;
      while (j < out.length && " \t\n\r".includes(out[j])) j++;
      if (out[j] === "}" || out[j] === "]") continue;
    }
    res += c;
  }
  return res;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k] = val;
  return out;
}

/**
 * Reads the servers out of a pasted config. Accepts the layouts used by
 * Claude Desktop / Cursor / Windsurf ("mcpServers"), Claude Code (also
 * per-project "projects.*.mcpServers"), VS Code mcp.json ("servers") and VS
 * Code settings ("mcp.servers"). A bare map of servers also works.
 */
export function parseConfig(text: string): { servers: CheckServer[]; skipped: string[] } {
  const clean = stripJsonc(text).trim();
  if (!clean) throw new ConfigError("Paste a config file first.");
  let doc: unknown;
  try {
    doc = JSON.parse(clean);
  } catch {
    throw new ConfigError("That isn't valid JSON. Paste the whole file, including the outer { }.");
  }
  if (!isObj(doc)) throw new ConfigError("Expected a JSON object with your servers in it.");

  const groups: { scope?: string; map: Record<string, unknown> }[] = [];
  if (isObj(doc.mcpServers)) groups.push({ map: doc.mcpServers });
  if (isObj(doc.servers)) groups.push({ map: doc.servers });
  if (isObj(doc.mcp) && isObj(doc.mcp.servers)) groups.push({ map: doc.mcp.servers });
  if (isObj(doc.projects)) {
    for (const p of Object.keys(doc.projects).sort()) {
      const proj = doc.projects[p];
      if (isObj(proj) && isObj(proj.mcpServers)) groups.push({ scope: p, map: proj.mcpServers });
    }
  }
  // A bare map: every value looks like a server entry.
  if (groups.length === 0) {
    const vals = Object.values(doc);
    if (vals.length > 0 && vals.every((v) => isObj(v) && ("command" in v || "url" in v || "serverUrl" in v))) {
      groups.push({ map: doc });
    }
  }
  if (groups.length === 0) {
    throw new ConfigError('No AI connectors found. Look for a "mcpServers" or "servers" section in the file.');
  }

  const servers: CheckServer[] = [];
  const skipped: string[] = [];
  for (const g of groups) {
    for (const name of Object.keys(g.map).sort()) {
      const raw = g.map[name];
      if (!isObj(raw)) {
        skipped.push(g.scope ? `${g.scope}: ${name}` : name);
        continue;
      }
      let command = typeof raw.command === "string" ? raw.command : "";
      let args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === "string") : [];
      // A server already protected by zinloop's launcher: check the real command.
      if (isLauncherName(command) && args[0] === "exec") {
        const dd = args.indexOf("--");
        if (dd >= 0 && dd + 1 < args.length) {
          command = args[dd + 1];
          args = args.slice(dd + 2);
        }
      }
      const url = typeof raw.url === "string" ? raw.url : typeof raw.serverUrl === "string" ? raw.serverUrl : "";
      servers.push({ name, scope: g.scope, command, args, url, env: strMap(raw.env), headers: strMap(raw.headers) });
    }
  }
  return { servers, skipped };
}

function isLauncherName(command: string): boolean {
  const b = baseName(command.toLowerCase()).replace(/\.exe$/, "");
  return b === "zinloop" || b === "agentscan";
}

// ---------- secret helpers ----------

function isLiteral(v: string): boolean {
  const t = v.trim();
  return t !== "" && !reference.test(t);
}

function parseUrl(v: string): URL | null {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

function hostnameOf(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, "");
}

export function urlHasCredential(v: string): boolean {
  if (!v.includes("://")) return false;
  const u = parseUrl(v);
  if (!u || !u.host) return false;
  if (v.replace(secretValueAll, "") !== v) return true;
  if (u.password) {
    let pw = u.password;
    try {
      pw = decodeURIComponent(pw);
    } catch {
      // Malformed escapes (pass%word): still a literal password.
    }
    if (isLiteral(pw)) return true;
  }
  for (const [k, val] of u.searchParams) {
    if (secretKeyName.test(k) && isLiteral(val)) return true;
  }
  return false;
}

export function secretArgs(args: string[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (secretValue.test(a) || urlHasCredential(a)) {
      idx.push(i);
    } else if (a.startsWith("-") && a.includes("=")) {
      const body = a.replace(/^-+/, "");
      const eq = body.indexOf("=");
      if (secretKeyName.test(body.slice(0, eq)) && isLiteral(body.slice(eq + 1))) idx.push(i);
    } else if (a.startsWith("-") && secretKeyName.test(a.replace(/^-+/, ""))) {
      if (i + 1 < args.length && !args[i + 1].startsWith("-") && isLiteral(args[i + 1])) {
        idx.push(i + 1);
        i++;
      }
    }
  }
  return idx;
}

export function secretEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env)
    .filter((k) => {
      const v = env[k];
      return isLiteral(v) && (secretKeyName.test(k) || secretValue.test(v) || urlHasCredential(v));
    })
    .sort();
}

function secretHeaderKeys(h: Record<string, string>): string[] {
  return Object.keys(h)
    .filter((k) => {
      const v = h[k];
      return isLiteral(v) && (k.toLowerCase() === "authorization" || secretKeyName.test(k) || secretValue.test(v));
    })
    .sort();
}

// ---------- rules ----------

function secretsInConfig(s: CheckServer): CheckFinding[] {
  const names: string[] = [];
  for (const k of secretEnvKeys(s.env)) names.push("env " + k);
  for (const k of secretHeaderKeys(s.headers)) names.push("header " + k);
  for (const i of secretArgs(s.args)) names.push("argument " + (i + 1));
  if (urlHasCredential(s.url)) names.push("server URL");
  if (names.length === 0) return [];
  names.sort();
  return [
    {
      ruleId: "SECRET_IN_CONFIG",
      severity: "high",
      title: "Credential stored in plain text",
      detail: `A long-lived key or token is written directly in the config file (${names.join(", ")}). Anyone or anything that can read this file, including other AI tools and malware, can reuse it.`,
      fix: "Move the value to the operating system's keychain or an environment variable, rotate the key, and give the replacement the smallest permissions it needs.",
    },
  ];
}

function insecureTransport(s: CheckServer): CheckFinding[] {
  if (!s.url) return [];
  const u = parseUrl(s.url);
  if (!u || u.protocol !== "http:" || isLocalHost(hostnameOf(u))) return [];
  return [
    {
      ruleId: "INSECURE_TRANSPORT",
      severity: "high",
      title: "Unencrypted connection to a remote server",
      detail: `This server is reached over plain http at ${u.host}. Requests, responses and any tokens can be read or changed on the network.`,
      fix: "Switch the URL to https, or remove the server if the provider does not support it.",
    },
  ];
}

const packageFlags: Record<string, string[]> = {
  npx: ["-p", "--package"],
  bunx: ["-p", "--package"],
  pnpm: ["--package"],
  yarn: ["-p", "--package"],
  bun: ["-p", "--package"],
  uvx: ["--from"],
};
const valueFlags: Record<string, string[]> = {
  npx: ["-c", "--call", "--registry", "--cache", "--userconfig", "-w", "--workspace"],
  bunx: ["--registry", "--cwd"],
  pnpm: ["--registry", "-C", "--dir"],
  yarn: ["--registry", "--cwd"],
  bun: ["--registry", "--cwd"],
  uvx: [
    "--with", "-w", "--with-editable", "--with-requirements", "-p", "--python",
    "--index", "--index-url", "-i", "--extra-index-url", "--default-index", "-f", "--find-links",
    "-c", "--constraints", "--overrides", "-b", "--build-constraints", "--cache-dir",
    "--directory", "--project", "--config-file", "--env-file", "--color", "--resolution",
    "--prerelease", "--exclude-newer", "-P", "--upgrade-package", "--reinstall-package",
    "--refresh-package", "--no-binary-package", "--no-build-package", "--index-strategy",
    "--keyring-provider", "--link-mode", "-C", "--config-setting", "--allow-insecure-host",
  ],
};

function firstPackageArg(runner: string, args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return args[i + 1] ?? "";
    if (!a.startsWith("-")) return a;
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(0, eq) : a;
    const hasVal = eq >= 0;
    if (packageFlags[runner]?.includes(name)) {
      if (hasVal) return a.slice(eq + 1);
      return args[i + 1] ?? "";
    }
    if (valueFlags[runner]?.includes(name) && !hasVal) i++;
  }
  return "";
}

function isPinned(runner: string, pkg: string): boolean {
  if (runner === "uvx") {
    const eq = pkg.indexOf("==");
    if (eq > 0) return pyExactVersion.test(pkg.slice(eq + 2));
    const m = pkgVersion.exec(pkg);
    return m ? pyExactVersion.test(m[2]) : false;
  }
  const m = pkgVersion.exec(pkg);
  return m !== null && npmExactVersion.test(m[2]);
}

function stripVersion(pkg: string): string {
  const m = pkgVersion.exec(pkg);
  return m ? pkg.slice(0, pkg.length - m[2].length - 1) : pkg;
}

function packageRunner(s: CheckServer): { runner: string; args: string[] } | null {
  const runner = baseName(s.command.toLowerCase()).replace(/\.cmd$/, "").replace(/\.exe$/, "");
  let args = s.args;
  if (["pnpm", "yarn", "bun"].includes(runner)) {
    if (args.length === 0 || (args[0] !== "dlx" && args[0] !== "x")) return null;
    args = args.slice(1);
  } else if (!["npx", "bunx", "uvx"].includes(runner)) {
    return null;
  }
  return { runner, args };
}

function unpinnedPackage(s: CheckServer): CheckFinding[] {
  const pr = packageRunner(s);
  if (!pr) return [];
  const pkg = firstPackageArg(pr.runner, pr.args);
  if (!pkg) return [];
  // UNTRUSTED_SOURCE already covers git URLs, direct URLs and local paths.
  if (untrustedSourcePrefix.test(pkg)) return [];
  if (isPinned(pr.runner, pkg)) return [];
  return [
    {
      ruleId: "UNPINNED_PACKAGE",
      severity: "medium",
      title: "Downloads the newest code on every start",
      detail: `This server runs ${pkg} through ${pr.runner} without a fixed version. If the package is taken over or a bad update is published, it runs on this computer automatically.`,
      fix: `Pin an exact, reviewed version (for example ${stripVersion(pkg)}@1.2.3) and update it on purpose.`,
    },
  ];
}

function isBroadPath(p: string): boolean {
  p = p.trim();
  if (!p || p.startsWith("-") || p.startsWith("@")) return false;
  const exact = ["/", "~", "~/", "$HOME", "${HOME}", "/Users", "/home", "C:\\", "C:/", "C:\\Users", "%USERPROFILE%"];
  if (exact.includes(p)) return true;
  // A home folder: /Users/name, /home/name, C:\Users\name (the browser can't
  // know the visitor's home, so match the shape).
  const clean = p.replace(/[/\\]+$/, "");
  if (/^\/(Users|home)\/[^/]+$/.test(clean) || /^[A-Za-z]:[\\/]Users[\\/][^\\/]+$/.test(clean)) return true;
  if (p.length >= 2 && p.length <= 3 && p[1] === ":") return true;
  return false;
}

function broadFilesystem(s: CheckServer): CheckFinding[] {
  if (!fsServer.test(s.command + " " + s.args.join(" "))) return [];
  for (const a of s.args) {
    if (isBroadPath(a)) {
      return [
        {
          ruleId: "BROAD_FILESYSTEM",
          severity: "high",
          title: "Can read and write far more files than it needs",
          detail: `The filesystem server is allowed into ${a}. That covers documents, SSH keys, browser data and other apps' secrets.`,
          fix: "Limit it to the one project folder the agent needs, and use a read-only server where writing isn't required.",
        },
      ];
    }
  }
  return [];
}

function shellAccess(s: CheckServer): CheckFinding[] {
  const all = s.command + " " + s.args.join(" ");
  const base = baseName(s.command).toLowerCase();
  const isShell = ["bash", "sh", "zsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh"].includes(base);
  const isShellServer = shellServer.test(all);
  if (!isShellServer && !isShell) return [];
  if (isShell && !isShellServer) {
    return [
      {
        ruleId: "SHELL_LAUNCHER",
        severity: "low",
        title: "Started through a shell command",
        detail: `This server is launched with ${base}, which makes it harder to see what actually runs.`,
        fix: "Call the server's program directly instead of wrapping it in a shell.",
      },
    ];
  }
  return [
    {
      ruleId: "SHELL_ACCESS",
      severity: "high",
      title: "Agent can run any command on this computer",
      detail: "This server gives the AI a terminal. A single malicious instruction hidden in an email, web page or file the agent reads could run commands with the user's full rights.",
      fix: "Remove it, or replace it with a server that only allows a short list of approved commands and asks before each run.",
    },
  ];
}

function mountsSensitive(spec: string): boolean {
  let src = spec.split(":")[0];
  if (spec.startsWith("type=bind") || spec.includes("source=")) {
    for (const part of spec.split(",")) {
      if (part.startsWith("source=") || part.startsWith("src=")) src = part.slice(part.indexOf("=") + 1);
    }
  }
  return src === "/" || src.includes("docker.sock") || src === "~" || src === "$HOME" || src === "${HOME}" || src === "/etc" || src === "/root";
}

function riskyContainer(s: CheckServer): CheckFinding[] {
  const base = baseName(s.command).toLowerCase();
  if (base !== "docker" && base !== "docker.exe" && base !== "podman") return [];
  const reasons: string[] = [];
  s.args.forEach((a, i) => {
    const next = s.args[i + 1] ?? "";
    if (a === "--privileged") reasons.push("runs privileged");
    else if (((a === "--network" || a === "--net") && next === "host") || a === "--network=host" || a === "--net=host")
      reasons.push("shares the host network");
    else if ((a === "-v" || a === "--volume" || a === "--mount") && mountsSensitive(next)) reasons.push("mounts " + next.split(":")[0]);
    else if (a.startsWith("--volume=") && mountsSensitive(a.slice(9))) reasons.push("mounts " + a.slice(9).split(":")[0]);
  });
  if (reasons.length === 0) return [];
  return [
    {
      ruleId: "RISKY_CONTAINER",
      severity: "high",
      title: "Container can escape to the host",
      detail: `This server's container ${reasons.join(", ")}, so the container gives little protection.`,
      fix: "Drop --privileged and host networking, and mount only the folder the server needs, read-only if possible.",
    },
  ];
}

function remoteServer(s: CheckServer): CheckFinding[] {
  if (!s.url) return [];
  const u = parseUrl(s.url);
  if (!u || isLocalHost(hostnameOf(u))) return [];
  return [
    {
      ruleId: "REMOTE_SERVER",
      severity: "low",
      title: "Sends data to an outside service",
      detail: `Whatever the agent passes to this server goes to ${hostnameOf(u)}.`,
      fix: "Confirm the company approves this provider and that a data agreement is in place.",
    },
  ];
}

function isLocalHost(h: string): boolean {
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h === "::1";
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function hiddenInstructions(s: CheckServer): CheckFinding[] {
  const where: string[] = [];
  const check = (label: string, v: string) => {
    if (!v) return;
    if (hiddenChars.test(v)) where.push(label + " (hidden characters)");
    else if (injectionPhrase.test(v)) where.push(label + " (injection phrase)");
  };
  check("server name", s.name);
  check("command", s.command);
  s.args.forEach((a, i) => check("argument " + (i + 1), a));
  for (const k of Object.keys(s.env).sort()) check("env " + k, s.env[k]);
  for (const k of Object.keys(s.headers).sort()) check("header " + k, s.headers[k]);
  check("server URL", s.url);
  if (where.length === 0) return [];
  where.sort();
  return [
    {
      ruleId: "HIDDEN_INSTRUCTIONS",
      severity: "high",
      title: "Hidden text or injection phrases in the config",
      detail: `This server has text that an agent will read but a human reviewer may miss (${where.join(", ")}). That is how tool-poisoning and prompt-injection attacks on MCP servers hide payloads.`,
      fix: "Remove the hidden characters or override phrases, and only trust tool descriptions from servers you fully control.",
    },
  ];
}

function untrustedSource(s: CheckServer): CheckFinding[] {
  const pr = packageRunner(s);
  if (!pr) return [];
  const pkg = firstPackageArg(pr.runner, pr.args);
  if (!pkg || !untrustedSourcePrefix.test(pkg)) return [];
  let kind = "a URL or local path";
  if (/^git\+/.test(pkg) || /^git:\/\//.test(pkg) || /^git@/.test(pkg)) kind = "a git source";
  else if (/^https?:\/\//.test(pkg)) kind = "a direct URL";
  else if (/^file:/.test(pkg) || /^\.\//.test(pkg) || /^\.\\/.test(pkg) || pkg.startsWith("/") || pkg.startsWith("~")) kind = "a local path";
  return [
    {
      ruleId: "UNTRUSTED_SOURCE",
      severity: "high",
      title: "Installed from outside the package registry",
      detail: `This server is pulled from ${kind} (${pkg}) instead of npm or PyPI. It skips registry provenance and can change silently between runs.`,
      fix: "Publish the server to a registry and pin an exact version, or vendor the code and run it from a reviewed, read-only location.",
    },
  ];
}

function untrustedRegistry(s: CheckServer): CheckFinding[] {
  const pr = packageRunner(s);
  if (!pr) return [];
  const hosts: string[] = [];
  const flags = new Set(["--registry", "--index", "--index-url", "-i", "--extra-index-url", "--default-index"]);
  for (let i = 0; i < pr.args.length; i++) {
    const a = pr.args[i];
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (!flags.has(name)) continue;
    let raw = "";
    if (eq >= 0) raw = a.slice(eq + 1);
    else if (i + 1 < pr.args.length) {
      raw = pr.args[i + 1];
      i++;
    }
    if (!raw) continue;
    const u = parseUrl(raw);
    if (!u || !u.host) continue;
    const host = hostnameOf(u).toLowerCase();
    const trusted = pr.runner === "uvx" ? trustedPyHost.test(host) : trustedNpmHost.test(host);
    if (trusted) continue;
    hosts.push(name + " " + host);
  }
  if (hosts.length === 0) return [];
  hosts.sort();
  return [
    {
      ruleId: "UNTRUSTED_REGISTRY",
      severity: "medium",
      title: "Package comes from a non-standard registry",
      detail: `This server fetches its code through ${hosts.join(", ")} instead of the default registry. If that registry is taken over or replaced, every start installs code it serves.`,
      fix: "Remove the registry override, or confirm the host is on the company's approved list and pin the exact version.",
    },
  ];
}

function hasBroadScope(v: string): boolean {
  const t = v.trim();
  if (!t || !isLiteral(t)) return false;
  return broadOAuthScope.test(" " + t.replace(/,/g, " ") + " ");
}

function oauthBroadScope(s: CheckServer): CheckFinding[] {
  const isScopeKey = (k: string) => {
    const lk = k.toLowerCase();
    return lk.includes("scope") || lk.includes("scopes") || lk.includes("permission");
  };
  const where: string[] = [];
  for (const k of Object.keys(s.env).sort()) {
    if (isScopeKey(k) && hasBroadScope(s.env[k])) where.push("env " + k);
  }
  for (const k of Object.keys(s.headers).sort()) {
    if (isScopeKey(k) && hasBroadScope(s.headers[k])) where.push("header " + k);
  }
  for (let i = 0; i < s.args.length; i++) {
    const a = s.args[i];
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(0, eq) : a;
    const flagName = name.replace(/^-+/, "");
    if (!name.startsWith("-") || !isScopeKey(flagName)) continue;
    if (eq >= 0) {
      if (hasBroadScope(a.slice(eq + 1))) where.push("argument " + (i + 1));
    } else if (i + 1 < s.args.length && hasBroadScope(s.args[i + 1])) {
      where.push("argument " + (i + 2));
      i++;
    }
  }
  if (s.url) {
    const u = parseUrl(s.url);
    if (u) {
      for (const [k, v] of u.searchParams) {
        if (isScopeKey(k) && hasBroadScope(v)) {
          where.push("URL query " + k);
          break;
        }
      }
    }
  }
  if (where.length === 0) return [];
  where.sort();
  return [
    {
      ruleId: "OAUTH_BROAD_SCOPE",
      severity: "medium",
      title: "OAuth scope is wider than the server needs",
      detail: `This server asks for admin-level or write-all OAuth scopes (${where.join(", ")}). If the token leaks, the attacker gets the same wide access.`,
      fix: "Issue a token with only the scopes the server actually calls, and prefer read-only or resource-scoped tokens.",
    },
  ];
}

/** Runs every rule against one server, in the same order as the Go scanner. */
export function checkServer(s: CheckServer): CheckFinding[] {
  return [
    ...secretsInConfig(s),
    ...hiddenInstructions(s),
    ...insecureTransport(s),
    ...unpinnedPackage(s),
    ...untrustedSource(s),
    ...untrustedRegistry(s),
    ...broadFilesystem(s),
    ...shellAccess(s),
    ...riskyContainer(s),
    ...oauthBroadScope(s),
    ...remoteServer(s),
  ];
}

export function worstOf(fs: CheckFinding[]): Severity {
  let w: Severity = "none";
  for (const f of fs) if (rank[f.severity] > rank[w]) w = f.severity;
  return w;
}

// ---------- grading ----------

/**
 * A 0–100 score and letter grade. Each finding costs points; any high
 * finding caps the grade at C, and three or more highs mean F, so one
 * plain-text key can never hide behind a long list of clean servers.
 */
export function gradeFor(counts: { high: number; medium: number; low: number }): { score: number; grade: Grade } {
  const score = Math.max(0, Math.min(100, 100 - counts.high * 25 - counts.medium * 10 - counts.low * 3));
  let grade: Grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  if (counts.high > 0 && (grade === "A" || grade === "B")) grade = "C";
  if (counts.high >= 3) grade = "F";
  return { score, grade };
}

export function checkConfig(text: string): CheckResult {
  const { servers, skipped } = parseConfig(text);
  const checked: CheckedServer[] = servers.map((s) => ({
    name: s.name,
    scope: s.scope,
    kind: s.url ? "remote" : "local",
    findings: checkServer(s),
  }));
  checked.sort((a, b) => rank[worstOf(b.findings)] - rank[worstOf(a.findings)] || a.name.localeCompare(b.name));
  const counts = { high: 0, medium: 0, low: 0 };
  for (const s of checked) for (const f of s.findings) counts[f.severity]++;
  return { servers: checked, counts, skipped, ...gradeFor(counts) };
}

// ---------- sharing ----------

export interface ShareSummary {
  grade: Grade;
  high: number;
  medium: number;
  low: number;
  servers: number;
}

const clampCount = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{1,3}$/.test(v)) return null;
  return Number(v);
};

/**
 * Reads a shared result from URL parameters. Only a grade and counts are
 * ever shared: no server names, commands or values. Anything malformed
 * gives null so the share page shows a plain "check yours" prompt.
 */
export function parseShare(p: Record<string, string | string[] | undefined>): ShareSummary | null {
  const one = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const g = one("g");
  if (!g || !/^[ABCDF]$/.test(g)) return null;
  const high = clampCount(one("h"));
  const medium = clampCount(one("m"));
  const low = clampCount(one("l"));
  const servers = clampCount(one("n"));
  if (high === null || medium === null || low === null || servers === null) return null;
  return { grade: g as Grade, high, medium, low, servers };
}

export function shareQuery(r: CheckResult): string {
  const q = new URLSearchParams({
    g: r.grade,
    h: String(Math.min(999, r.counts.high)),
    m: String(Math.min(999, r.counts.medium)),
    l: String(Math.min(999, r.counts.low)),
    n: String(Math.min(999, r.servers.length)),
  });
  return q.toString();
}

export const gradeBlurb: Record<Grade, string> = {
  A: "No risky settings found.",
  B: "A few things to tidy up.",
  C: "At least one serious risk.",
  D: "Several serious risks.",
  F: "Wide open. Fix this today.",
};

export const gradeColor: Record<Grade, string> = {
  A: "#2f7d4f",
  B: "#5b8a2f",
  C: "#b7791f",
  D: "#c05621",
  F: "#b42318",
};

/** Base for absolute share-card URLs, from the deployment's CONSOLE_URL. Server-side only. */
export function siteBase(): URL | undefined {
  const u = typeof process !== "undefined" ? process.env.CONSOLE_URL?.trim() : undefined;
  if (!u) return undefined;
  try {
    return new URL(u);
  } catch {
    return undefined;
  }
}

const placeholder = /(example|your|xxxx|placeholder|redacted|dummy|test|<|>|\*{3})/i;

/**
 * True when some value in the server looks like a real credential (a known
 * token format) rather than a placeholder such as "YOUR_API_KEY". Used by the
 * public-config research so tutorials full of placeholders don't inflate the
 * leaked-key numbers.
 */
export function hasTokenShapedValue(s: CheckServer): boolean {
  const values = [...Object.values(s.env), ...Object.values(s.headers), ...s.args, s.url];
  return values.some((v) => {
    const m = v.match(secretValue);
    return m !== null && !placeholder.test(m[0]);
  });
}
