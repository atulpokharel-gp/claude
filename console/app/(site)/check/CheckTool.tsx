"use client";

import { useState } from "react";
import Link from "next/link";
import { checkConfig, ConfigError, gradeBlurb, shareQuery, type CheckResult } from "@/lib/mcp-check.ts";

// A made-up config with typical mistakes. The token is assembled at runtime so
// no token-shaped string sits in the source.
const example = () =>
  JSON.stringify(
    {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_" + "EXAMPLE0".repeat(5) },
        },
        files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2025.8.21", "/Users/sam"] },
        terminal: { command: "npx", args: ["-y", "@wonderwhy-er/desktop-commander"] },
        wiki: { url: "http://wiki.example.com/mcp" },
        time: { command: "uvx", args: ["mcp-server-time==0.6.2"] },
      },
    },
    null,
    2,
  );

const where: [string, string][] = [
  ["Claude Desktop (Mac)", "~/Library/Application Support/Claude/claude_desktop_config.json"],
  ["Claude Desktop (Windows)", "%APPDATA%\\Claude\\claude_desktop_config.json"],
  ["Claude Code", "~/.claude.json or .mcp.json in your project"],
  ["Cursor", "~/.cursor/mcp.json or .cursor/mcp.json in your project"],
  ["VS Code", ".vscode/mcp.json, or \"mcp\" in settings.json"],
  ["Windsurf", "~/.codeium/windsurf/mcp_config.json"],
];

export function CheckTool() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  function run(input = text) {
    setCopied("");
    try {
      const r = checkConfig(input);
      setResult(r);
      setError("");
      // Public counter for /live. Grade only, no servers, no config content.
      void pulse(["check_run", `grade:${r.grade}`]);
    } catch (e) {
      setResult(null);
      setError(e instanceof ConfigError ? e.message : "Something went wrong reading that file.");
    }
  }

  async function pulse(buckets: string[]) {
    try {
      await fetch("/api/public/pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buckets }),
        keepalive: true,
      });
    } catch {
      // Counter failures must never block the checker.
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      if (label === "link" || label === "badge") void pulse(["share_created"]);
    } catch {
      setCopied("");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const shareUrl = result ? `${origin}/check/r?${shareQuery(result)}` : "";
  const shareText = result
    ? `My AI assistant setup scored ${result.grade} on the Zinloop AI connector check. Took 10 seconds and nothing left my browser. What does yours score?`
    : "";
  const badge = result ? `[![AI setup: ${result.grade}](${origin}/check/badge?g=${result.grade})](${origin}/check)` : "";

  return (
    <div className="checker stack" style={{ gap: 20 }}>
      <label className="zfield">
        <span>Paste your AI connector config</span>
        <textarea
          className="mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          autoComplete="off"
          placeholder={'{\n  "mcpServers": {\n    ...\n  }\n}'}
        />
      </label>
      <div className="buttons">
        <button type="button" className="zbtn zbtn-main" onClick={() => run()}>
          Check my setup
        </button>
        <button
          type="button"
          className="zbtn zbtn-ghost"
          onClick={() => {
            const ex = example();
            setText(ex);
            run(ex);
          }}
        >
          Try an example
        </button>
      </div>
      <p className="small">
        Runs in your browser. Your config, keys and server names are never sent anywhere, not even to us. You can turn
        off your network and it still works.
      </p>
      <details className="small">
        <summary>Where is my config file?</summary>
        <dl className="where">
          {where.map(([app, path]) => (
            <div key={app}>
              <dt>{app}</dt>
              <dd className="mono">{path}</dd>
            </div>
          ))}
        </dl>
      </details>

      {error && (
        <p className="zerror" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="result card strong" aria-live="polite">
          <div className="grade-row">
            <span className={`grade grade-${result.grade}`} aria-label={`Grade ${result.grade}`}>
              {result.grade}
            </span>
            <div>
              <p className="disp h2">{gradeBlurb[result.grade]}</p>
              <p className="body">
                {result.servers.length} connector{result.servers.length === 1 ? "" : "s"} checked · {result.counts.high} high ·{" "}
                {result.counts.medium} medium · {result.counts.low} low · score {result.score}/100
              </p>
            </div>
          </div>

          {result.skipped.length > 0 && (
            <p className="small">Not checked (couldn&apos;t read): {result.skipped.join(", ")}</p>
          )}

          <ul className="servers">
            {result.servers.map((s) => (
              <li key={(s.scope ?? "") + s.name}>
                <p>
                  <b>{s.name}</b>
                  {s.scope && <span className="small"> · {s.scope}</span>}
                  {s.findings.length === 0 && <span className="sev ok"> CLEAN</span>}
                </p>
                {s.findings.map((f) => (
                  <div className="item" key={f.ruleId}>
                    <span className={`sev ${f.severity}`}>{f.severity.toUpperCase()}</span>
                    <div>
                      <b>{f.title}</b>
                      <span className="body">{f.detail}</span>
                      <span className="fix">Fix: {f.fix}</span>
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>

          <div className="share stack" style={{ gap: 10 }}>
            <p className="eyebrow">Share your grade</p>
            <p className="small">The link shows only the letter and the counts. No server names or keys.</p>
            <div className="buttons">
              <button type="button" className="zbtn zbtn-ghost" onClick={() => copy("link", shareUrl)}>
                {copied === "link" ? "Link copied" : "Copy link"}
              </button>
              <a
                className="zbtn zbtn-ghost"
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void pulse(["share_created"])}
              >
                LinkedIn
              </a>
              <a
                className="zbtn zbtn-ghost"
                href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void pulse(["share_created"])}
              >
                X
              </a>
              <button type="button" className="zbtn zbtn-ghost" onClick={() => copy("badge", badge)}>
                {copied === "badge" ? "Badge copied" : "Copy README badge"}
              </button>
            </div>
          </div>

          <div className="fixbox">
            <p className="body">
              <b>This was one config on one computer.</b> Your team has more. The free Zinloop scanner checks every
              laptop, moves plain-text keys into the system keychain with one command, and gives you a report.
            </p>
            <div className="buttons">
              <Link className="zbtn zbtn-main" href="/free-scan">
                Scan every laptop free
              </Link>
              <Link className="zbtn zbtn-ghost" href="/msps">
                I&apos;m an MSP
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
