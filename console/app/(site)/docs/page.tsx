import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Docs" };

export default function Docs() {
  return (
    <section className="section">
      <div className="wrap doc">
        <nav aria-label="Docs">
          <a href="#start">Getting started</a>
          <a href="#rmm">Install with your RMM</a>
          <a href="#windows">Windows script</a>
          <a href="#unix">macOS and Linux script</a>
          <a href="#manual">Run it by hand</a>
          <a href="#fix">Fix plain-text keys</a>
          <a href="#rotate">Replace exposed keys</a>
          <a href="#files">Files the scanner reads</a>
          <a href="#cli">Command reference</a>
        </nav>
        <article>
          <p className="eyebrow">Docs</p>
          <h1 className="disp h2">Install and use Zinloop</h1>

          <h2 id="start">Getting started</h2>
          <ol className="list">
            <li><Link href="/free-scan">Create an account</Link> and sign in.</li>
            <li>Add a client, then open it and create an <b>upload token</b>. Copy it; it's shown once.</li>
            <li>Run the install script on the client's laptops through your RMM (below). Scans show up within a minute.</li>
          </ol>

          <h2 id="rmm">Install with your RMM</h2>
          <p>
            The scripts run as SYSTEM (Windows) or root (macOS, Linux). They download the scanner from your console, check
            its SHA-256 checksum, store the token where only administrators can read it, scan every user profile and send the
            report. Set two variables in your RMM tool:
          </p>
          <div className="table-box"><table>
            <thead><tr><th>Variable</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td><code>ZINLOOP_CONSOLE_URL</code></td><td>Your console address, for example <code>https://zinloop.com</code></td></tr>
              <tr><td><code>ZINLOOP_TOKEN</code></td><td>The client's upload token, starting <code>zlu_</code></td></tr>
            </tbody>
          </table></div>
          <p>NinjaOne: add the script under Administration › Library › Automation and use script variables. Datto RMM: create a component with two site or component variables. N-able and ConnectWise Automate: create a script with the two values as parameters.</p>

          <h3 id="windows">Windows (PowerShell)</h3>
          <p>Download <a href="/download/install-windows.ps1">install-windows.ps1</a>. Add <code>-Schedule</code> to run it daily at 10:00.</p>
          <pre>{"powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Schedule"}</pre>

          <h3 id="unix">macOS and Linux</h3>
          <p>Download <a href="/download/install-unix.sh">install-unix.sh</a>. Set <code>ZINLOOP_SCHEDULE=1</code> to run it daily.</p>
          <pre>{"sudo ZINLOOP_CONSOLE_URL=https://zinloop.com ZINLOOP_TOKEN=zlu_... ZINLOOP_SCHEDULE=1 sh install-unix.sh"}</pre>

          <h2 id="manual">Run it by hand</h2>
          <p>Download the build for the computer from <code>/download/zinloop-&lt;os&gt;-&lt;cpu&gt;</code> on your console, then:</p>
          <pre>{"zinloop                     # readable summary for the current user\nzinloop --json --out scan.json\nzinloop --all-users         # every profile (run as administrator or root)\nZINLOOP_TOKEN=zlu_... zinloop --upload https://zinloop.com/api/scans"}</pre>
          <p>Without <code>--upload</code> the scanner sends nothing. You can open a saved <code>scan.json</code> in the console under <b>Open a scan file</b>.</p>

          <h2 id="fix">Fix plain-text keys</h2>
          <p>Run as the laptop's user, with the AI apps closed:</p>
          <pre>{"zinloop fix-secrets            # preview, changes nothing\nzinloop fix-secrets --apply    # move keys into the keychain"}</pre>
          <p>
            For each config file, Zinloop saves the keys in the system keychain and reads them back, copies the original file
            to <code>&lt;file&gt;.zinloop-backup-&lt;time&gt;</code>, and rewrites each connector to start through <code>zinloop exec</code>.
            If any step fails, the file is left as it was. Keys in headers, arguments or addresses are listed for fixing by hand.
            Keep the scanner in a permanent place (the install scripts use <code>C:\ProgramData\Zinloop</code> and <code>/usr/local/zinloop</code>), because its path is written into the configs.
          </p>

          <h2 id="rotate">Replace exposed keys</h2>
          <p>A key that sat in plain text may already have been copied. Create a new key with the provider, then:</p>
          <pre>{"zinloop rotate --list\nzinloop rotate <name>          # paste the new key when asked"}</pre>

          <h2 id="files">Files the scanner reads</h2>
          <div className="table-box"><table>
            <thead><tr><th>App</th><th>Files</th></tr></thead>
            <tbody>
              <tr><td>Claude Desktop</td><td><code>claude_desktop_config.json</code> in the app's settings folder</td></tr>
              <tr><td>Claude Code</td><td><code>~/.claude.json</code>, project <code>.mcp.json</code></td></tr>
              <tr><td>Cursor</td><td><code>~/.cursor/mcp.json</code>, project <code>.cursor/mcp.json</code></td></tr>
              <tr><td>Windsurf</td><td><code>~/.codeium/windsurf/mcp_config.json</code></td></tr>
              <tr><td>VS Code</td><td>User <code>mcp.json</code> and <code>settings.json</code>, project <code>.vscode/mcp.json</code></td></tr>
            </tbody>
          </table></div>

          <h2 id="cli">Command reference</h2>
          <div className="table-box"><table>
            <thead><tr><th>Option</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>--json</code></td><td>Print the report as JSON</td></tr>
              <tr><td><code>--out FILE</code></td><td>Also save the JSON report (owner-only file)</td></tr>
              <tr><td><code>--all-users</code></td><td>Scan every user profile on the computer</td></tr>
              <tr><td><code>--project DIR</code></td><td>Also check a project folder (repeatable)</td></tr>
              <tr><td><code>--upload URL</code></td><td>Send the report to the console; token from <code>ZINLOOP_TOKEN</code> or <code>--token-file</code></td></tr>
              <tr><td><code>--fail-on LEVEL</code></td><td>Exit with code 2 if anything is at or above high, medium or low</td></tr>
            </tbody>
          </table></div>
          <p>Exit codes: 0 done, 1 bad setup, 2 risk at or above <code>--fail-on</code>, 3 scan ran but upload failed.</p>
        </article>
      </div>
    </section>
  );
}
