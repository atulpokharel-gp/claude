import type { Metadata } from "next";
import Link from "next/link";
import { FindingCard } from "@/components/site/FindingCard.tsx";
import { CtaBand } from "@/components/site/CtaBand.tsx";

export const metadata: Metadata = { title: "How it works" };

const RULES: [string, string, string][] = [
  ["Password or token in plain text", "High", "Keys typed into a connector's settings, headers, arguments or address"],
  ["Gives the AI a terminal", "High", "Connectors that can run any command on the laptop"],
  ["Whole-disk file access", "High", "File connectors allowed into the home folder or a whole drive"],
  ["Unencrypted connection", "High", "Remote connectors over plain http"],
  ["Risky container settings", "High", "Docker with privileged mode, host networking or the Docker socket"],
  ["Unpinned package", "Medium", "Connectors that download whatever version is newest at every start"],
  ["Exposed key not replaced", "Medium", "A key Zinloop protected that was in plain text before and hasn't been rotated"],
  ["Sends data to an outside service", "Low", "Remote connectors, listed so you know where data goes"],
];

export default function HowItWorks() {
  return (
    <>
      <section className="section">
        <div className="wrap row center">
          <div className="col stack" style={{ gap: 20 }}>
            <p className="eyebrow">How it works</p>
            <h1 className="disp h1">Find it, fix it, prove it</h1>
            <p className="lead">
              Zinloop is a small scanner you push to laptops and a console where you see every client at once.
              The scanner only reads files. Nothing changes on a laptop until a technician runs a fix.
            </p>
          </div>
          <div className="col"><FindingCard /></div>
        </div>
      </section>

      <section className="band section">
        <div className="wrap stack" style={{ gap: 32 }}>
          <div className="head">
            <p className="eyebrow">1 · Find</p>
            <h2 className="disp h2">Every AI connector on every laptop</h2>
            <p className="body">
              AI assistants connect to company systems through small programs called MCP servers. Their settings live in
              files on the laptop. The scanner reads those files for every user profile on the computer:
            </p>
          </div>
          <div className="grid3">
            <div className="ruled"><h3>Claude Desktop and Claude Code</h3><p className="body">The desktop app's settings, Claude Code's global and per-project servers.</p></div>
            <div className="ruled"><h3>Cursor and Windsurf</h3><p className="body">User-wide and project connectors.</p></div>
            <div className="ruled"><h3>VS Code</h3><p className="body">User settings and project <code>.vscode/mcp.json</code> files.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap stack" style={{ gap: 28 }}>
          <div className="head">
            <p className="eyebrow">What it flags</p>
            <h2 className="disp h2">Plain rules, plain language</h2>
          </div>
          <div className="doc"><div className="table-box" style={{ width: "100%" }}>
            <table>
              <thead><tr><th>Finding</th><th>Risk</th><th>What it means</th></tr></thead>
              <tbody>
                {RULES.map(([name, risk, what]) => (
                  <tr key={name}><td><b>{name}</b></td><td>{risk}</td><td className="body">{what}</td></tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      </section>

      <section className="band section">
        <div className="wrap row">
          <div className="col stack">
            <p className="eyebrow">2 · Fix</p>
            <h2 className="disp h2">Keys move into the keychain. The AI tool keeps working.</h2>
            <p className="body">
              <code>zinloop fix-secrets --apply</code> saves each key in Windows Credential Manager, macOS Keychain or the
              Linux secret store, backs up the original file, and rewrites the connector to start through Zinloop, which
              hands the key over at start-up. If any step fails, the file is left exactly as it was.
            </p>
            <p className="body">
              Keys that sat in plain text should still be replaced. <code>zinloop rotate</code> lists them and takes the new
              key from the provider.
            </p>
          </div>
          <div className="col stack">
            <p className="eyebrow">3 · Prove</p>
            <h2 className="disp h2">A report your client can read</h2>
            <p className="body">
              Each client gets a risk score, the laptops that haven't reported, and a printable report in plain English:
              what was found, what was fixed, what still needs a decision.
            </p>
            <p><Link href="/docs">Install guide →</Link></p>
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
