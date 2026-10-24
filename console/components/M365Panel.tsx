import { connectM365Action, disconnectM365Action, syncM365Action } from "@/app/(console)/app/clients/m365-actions.ts";
import type { M365Status } from "@/lib/store.ts";

const NOTICES: Record<string, string> = {
  connected: "Microsoft 365 is connected and the first check is done.",
  declined: "Consent wasn't granted, so nothing was connected.",
  error: "Connected, but the first check failed. See the error below.",
  expired: "That consent link expired. Start again.",
  unavailable: "Microsoft 365 checks aren't set up on this console yet.",
};

export function M365Panel({ clientId, status, available, notice }: { clientId: string; status: M365Status | null; available: boolean; notice?: string }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>Microsoft 365</h2></div>
      <div className="panel-body">
        {notice && NOTICES[notice] && <p className={notice === "connected" ? "form-ok" : "form-error"} role="status">{NOTICES[notice]}</p>}
        {status ? (
          <>
            <p>
              Connected to tenant <code>{status.tenantId}</code>.{" "}
              {status.lastSync ? `Last checked ${new Date(status.lastSync).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC.` : "Not checked yet."}
            </p>
            {status.lastError && <p className="form-error">{status.lastError}</p>}
            <div className="actions">
              <form action={syncM365Action}><input type="hidden" name="clientId" value={clientId} /><button className="btn" type="submit">Check now</button></form>
              <form action={disconnectM365Action}><input type="hidden" name="clientId" value={clientId} /><button className="btn" type="submit">Disconnect</button></form>
            </div>
          </>
        ) : available ? (
          <>
            <p>Find AI apps that staff or admins gave access to this client's email, files and Teams chats, and revoke them in one click.</p>
            <p className="small muted">You'll be sent to Microsoft. A Global Administrator of the client's tenant must approve read access to app permissions.</p>
            <form action={connectM365Action}>
              <input type="hidden" name="clientId" value={clientId} />
              <button className="btn primary" type="submit">Connect Microsoft 365</button>
            </form>
          </>
        ) : (
          <p className="muted">Microsoft 365 checks aren't set up on this console yet. Whoever runs it needs to add M365_CLIENT_ID and M365_CLIENT_SECRET.</p>
        )}
      </div>
    </section>
  );
}
