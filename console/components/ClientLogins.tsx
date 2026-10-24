import type { ClientViewers } from "@/lib/accounts.ts";
import { cancelViewerInviteAction, removeViewerAction } from "@/app/(console)/app/clients/viewer-actions.ts";
import { InviteViewerForm } from "./InviteViewerForm.tsx";

/** Read-only logins for people at the client. Only the MSP's account owner can add or remove them. */
export function ClientLogins({ clientId, clientName, logins, isOwner }: { clientId: string; clientName: string; logins: ClientViewers; isOwner: boolean }) {
  const empty = logins.viewers.length === 0 && logins.invites.length === 0;
  return (
    <section className="panel" id="client-logins">
      <div className="panel-head">
        <h2>Client logins</h2>
        <span className="muted small">Read-only: they see this client&apos;s results and report, never other clients, and can&apos;t change anything.</span>
      </div>
      {empty ? (
        <p className="empty">Nobody at {clientName} has a login yet. Give their IT contact or manager one so they can check progress themselves.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Two-factor</th><th></th></tr></thead>
            <tbody>
              {logins.viewers.map((v) => (
                <tr key={v.id}>
                  <td>{v.name || "—"}</td>
                  <td>{v.email}</td>
                  <td>{v.mfa ? <span className="pill none">On</span> : <span className="pill medium">Off</span>}</td>
                  <td>
                    {isOwner && (
                      <form action={removeViewerAction.bind(null, clientId)}>
                        <input type="hidden" name="id" value={v.id} />
                        <button className="btn small" type="submit">Remove login</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {logins.invites.map((i) => (
                <tr key={i.id}>
                  <td className="muted">Invited</td>
                  <td>{i.email}</td>
                  <td className="muted">Expires {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td>
                    {isOwner && (
                      <form action={cancelViewerInviteAction.bind(null, clientId)}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="btn small" type="submit">Cancel invite</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-body">
        {isOwner ? <InviteViewerForm clientId={clientId} clientName={clientName} /> : <p className="muted">Only the account owner can give people at a client a login.</p>}
      </div>
    </section>
  );
}
