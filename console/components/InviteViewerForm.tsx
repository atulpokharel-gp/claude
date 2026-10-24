"use client";

import { useActionState } from "react";
import { inviteViewerAction, type ViewerInviteState } from "@/app/(console)/app/clients/viewer-actions.ts";

export function InviteViewerForm({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [state, action, pending] = useActionState<ViewerInviteState, FormData>(inviteViewerAction.bind(null, clientId), {});
  return (
    <>
      <form action={action} className="form inline">
        <label>
          Invite someone at {clientName} by email
          <input name="email" type="email" required defaultValue={state.link ? "" : state.email} key={state.link ?? state.email} />
        </label>
        <button className="btn primary" type="submit" disabled={pending}>Create viewer link</button>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
      </form>
      {state.link && (
        <div className="token-once">
          <p><b>Send this link to {state.email}.</b> It works once, for 7 days, and is shown only now. They&apos;ll see {clientName}&apos;s results and nothing else, and can&apos;t change anything.</p>
          <code className="block">{state.link}</code>
        </div>
      )}
    </>
  );
}
