"use client";

import { useActionState } from "react";
import { createTokenAction, revokeTokenAction, type TokenState } from "@/app/clients/actions.ts";
import type { UploadTokenInfo } from "@/lib/store.ts";

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never";
}

export function ConnectLaptops({ clientId, tokens, consoleUrl }: { clientId: string; tokens: UploadTokenInfo[]; consoleUrl: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(createTokenAction.bind(null, clientId), {});
  const uploadUrl = `${consoleUrl}/api/scans`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Connect laptops</h2>
        <span className="muted small">Laptops send their scan to this client with an upload token.</span>
      </div>

      {state.token ? (
        <div className="token-once" role="status">
          <p><b>Copy this token now.</b> It won&apos;t be shown again.</p>
          <code className="block">{state.token}</code>
          <p className="small">Put it in the <code>AGENTGUARD_TOKEN</code> environment variable in your RMM tool, then run on each laptop:</p>
          <code className="block">agentscan --upload {uploadUrl}</code>
        </div>
      ) : (
        <form action={action} className="form inline">
          <label>
            <span>Label <span className="muted">(optional)</span></span>
            <input name="label" placeholder="e.g. NinjaOne rollout" maxLength={200} />
          </label>
          <button type="submit" className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create upload token"}</button>
          {state.error && <p className="form-error" role="alert">{state.error}</p>}
        </form>
      )}

      {tokens.length > 0 && (
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
      )}
    </section>
  );
}
