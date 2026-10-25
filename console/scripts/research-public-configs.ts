// Counts how many AI connector (MCP) config files committed to public GitHub
// repos have risky settings, for the "State of AI connector security" report.
//
//   GITHUB_TOKEN=... npm run research:configs -- --out research-out
//
// It writes ONLY totals. It never saves key values, repo names, owners or
// file paths, so the output is safe to publish. Leaked keys found this way
// are also caught by GitHub's own secret scanning, which tells the owner.
//
// GitHub's code search allows about 10 requests a minute and 1,000 results
// per query, so a full run takes 20–40 minutes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkServer, hasTokenShapedValue, parseConfig, worstOf } from "../lib/mcp-check.ts";

export const queries = [
  "filename:claude_desktop_config.json mcpServers",
  "filename:mcp.json mcpServers path:.cursor",
  "filename:.mcp.json mcpServers",
  "filename:mcp.json servers path:.vscode",
  "filename:mcp_config.json mcpServers",
];

export interface FileStats {
  servers: number;
  rules: string[]; // rule ids found anywhere in the file, de-duplicated
  worst: "high" | "medium" | "low" | "none";
  tokenShaped: boolean;
}

export function statsFor(text: string): FileStats | null {
  let parsed;
  try {
    parsed = parseConfig(text);
  } catch {
    return null;
  }
  if (parsed.servers.length === 0) return null;
  const rules = new Set<string>();
  const all = [];
  let tokenShaped = false;
  for (const s of parsed.servers) {
    const fs = checkServer(s);
    all.push(...fs);
    for (const f of fs) rules.add(f.ruleId);
    if (hasTokenShapedValue(s)) tokenShaped = true;
  }
  return { servers: parsed.servers.length, rules: [...rules].sort(), worst: worstOf(all), tokenShaped };
}

export function summarize(files: FileStats[]) {
  const n = files.length;
  const pct = (k: number) => (n === 0 ? 0 : Math.round((k / n) * 1000) / 10);
  const byRule: Record<string, { files: number; percent: number }> = {};
  for (const f of files) for (const r of f.rules) byRule[r] = { files: (byRule[r]?.files ?? 0) + 1, percent: 0 };
  for (const r of Object.keys(byRule)) byRule[r].percent = pct(byRule[r].files);
  const worst = { high: 0, medium: 0, low: 0, none: 0 };
  for (const f of files) worst[f.worst]++;
  const tokenShaped = files.filter((f) => f.tokenShaped).length;
  return {
    files: n,
    servers: files.reduce((a, f) => a + f.servers, 0),
    anyHighPercent: pct(worst.high),
    tokenShapedKeyPercent: pct(tokenShaped),
    worst,
    byRule,
  };
}

async function gh(url: string, token: string, accept = "application/vnd.github+json"): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept, "User-Agent": "zinloop-research" } });
    if (res.status !== 403 && res.status !== 429) return res;
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
    const wait = Math.max(10_000, reset - Date.now() + 1000);
    console.error(`rate limited, waiting ${Math.round(wait / 1000)}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("GitHub kept rate-limiting; try again later");
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Set GITHUB_TOKEN (a fine-grained token with public read access is enough).");
    process.exit(1);
  }
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx > 0 ? process.argv[outIdx + 1] : "research-out";
  const seen = new Set<string>(); // file blob SHAs, kept in memory only, to skip copies
  const files: FileStats[] = [];
  for (const q of queries) {
    for (let page = 1; page <= 10; page++) {
      const res = await gh(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, token);
      if (!res.ok) break;
      const body = (await res.json()) as { items: { sha: string; url: string }[] };
      if (!body.items?.length) break;
      for (const item of body.items) {
        if (seen.has(item.sha)) continue;
        seen.add(item.sha);
        const raw = await gh(item.url, token, "application/vnd.github.raw+json");
        if (!raw.ok) continue;
        const s = statsFor(await raw.text());
        if (s) files.push(s);
      }
      console.error(`${q} page ${page}: ${files.length} files so far`);
      await new Promise((r) => setTimeout(r, 6500)); // stay under the search limit
    }
  }
  const summary = { ...summarize(files), queries, collected: new Date().toISOString() };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
