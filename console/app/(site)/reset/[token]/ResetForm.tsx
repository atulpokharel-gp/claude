"use client";

import { useActionState } from "react";
import { resetAction, type ResetState } from "./actions.ts";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetAction, {});
  return (
    <form action={action} className="zform">
      <input type="hidden" name="token" value={token} />
      <div className="zfield full">
        <label htmlFor="email">Email</label>
        <input id="email" value={email} readOnly autoComplete="username" />
      </div>
      <div className="zfield full">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
        <span className="hint">At least 12 characters.</span>
      </div>
      {state.error && <p className="zerror" role="alert">{state.error}</p>}
      <button type="submit" className="zbtn zbtn-main" disabled={pending}>{pending ? "Saving…" : "Set new password"}</button>
    </form>
  );
}
