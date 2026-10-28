"use client";

import { useActionState, useState } from "react";
import { createTokenAction, revokeTokenAction, type TokenState } from "@/app/(console)/app/clients/actions.ts";
import type { UploadTokenInfo } from "@/lib/store.ts";

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never";
}

type OS = "windows" | "macos" | "linux";

const OS_LABEL: Record<OS, string> = {
  windows: "Windows (PowerShell)",
  macos: "macOS (Terminal)",
  linux: "Linux (shell)",
};

/** Returns a one-command install snippet. {TOKEN} is replaced after the user clicks "Create upload token". */
function installCommand(os: OS, consoleUrl: string, token: string): string {
  if (os === "windows") {
    return [
      `$env:ZINLOOP_CONSOLE_URL = "${consoleUrl}"`,
      `$env:ZINLOOP_TOKEN = "${token}"`,
      `iwr "${consoleUrl}/download/install-windows.ps1" -UseBasicParsing | iex`,
    ].join("\n");
  }
  // One-liner for macOS and Linux. Pulls the install script and pipes to sh with env vars prefixed.
  return `curl -fsSL "${consoleUrl}/download/install-unix.sh" | ZINLOOP_CONSOLE_URL="${consoleUrl}" ZINLOOP_TOKEN="${token}" sudo -E sh`;
}

export function ConnectLaptops({ clientId, tokens, consoleUrl }: { clientId: string; tokens: UploadTokenInfo[]; consoleUrl: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(createTokenAction.bind(null, clientId), {});
  const [os, setOs] = useState<OS>(typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) ? "macos" : typeof navigator !== "undefined" && /Linux/i.test(navigator.userAgent) ? "linux" : "windows");
  const [copied, setCopied] = useState(false);

  const uploadUrl = `${consoleUrl}/api/scans`;
  const token = state.token ?? "ZINLOOP_TOKEN";
  const cmd = installCommand(os, consoleUrl, token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* no-op; the <pre> is selectable */ }
  }

  return (
    <section className="panel install">
      <div className="panel-head">
        <h2>Install the scanner</h2>
        <span className="muted small">One line per laptop. Push through your RMM, or run by hand on one laptop first.</span>
      </div>

      <div className="panel-body">
        {!state.token && (
          <>
            <ol className="install-steps muted small">
              <li><b>Create an upload token</b> for this client (shown once; copy it somewhere safe).</li>
              <li><b>Run the install command</b> on a laptop or push it through your RMM.</li>
              <li>The laptop sends its first scan within a minute. Findings appear above.</li>
            </ol>
            <form action={action} className="form inline">
              <label>
                <span>Token label <span className="muted">(optional, e.g. &quot;NinjaOne rollout&quot;)</span></span>
                <input name="label" placeholder="NinjaOne rollout" maxLength={200} />
              </label>
              <button type="submit" className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create upload token"}</button>
              {state.error && <p className="form-error" role="alert">{state.error}</p>}
            </form>
          </>
        )}

        {state.token && (
          <div className="token-once" role="status">
            <p><b>Here&apos;s your upload token for this client.</b> Copy it now — it won&apos;t be shown again.</p>
            <code className="block">{state.token}</code>
          </div>
        )}

        <div className="os-tabs" role="tablist" aria-label="Operating system">
          {(Object.keys(OS_LABEL) as OS[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={os === k}
              className={os === k ? "os-tab on" : "os-tab"}
              onClick={() => setOs(k)}
            >
              {OS_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="install-cmd">
          <pre><code>{cmd}</code></pre>
          <button type="button" className="btn small copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="muted small">
          {state.token
            ? "This command downloads the scanner, verifies its SHA-256, scans every user profile, and sends the report. Nothing changes on the laptop until a tech runs a fix."
            : <>Create a token above, then this command fills in <code>ZINLOOP_TOKEN</code>. Scanner is open source and verified by checksum.</>}
        </p>
        <p className="muted small">
          Prefer the raw scripts for your RMM? <a href={`${consoleUrl}/download/install-windows.ps1`}>install-windows.ps1</a>
          {" · "}
          <a href={`${consoleUrl}/download/install-unix.sh`}>install-unix.sh</a>
          {" · "}
          Upload endpoint: <code>{uploadUrl}</code>
        </p>
      </div>

      {tokens.length > 0 && (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <h3 className="muted small" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>Existing tokens for this client</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Token</th><th>Created</th><th>Last used</th><th /></tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.label || "Upload token"}</td>
                    <td className="muted small">{fmt(t.createdAt)}</td>
                    <td className="muted small">{fmt(t.lastUsed)}</td>
                    <td>
                      <form action={revokeTokenAction.bind(null, clientId, t.id)}>
                        <button type="submit" className="btn danger small">Revoke</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
