"use client";

import { useActionState } from "react";
import { joinAction } from "../../free-scan/actions.ts";

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(joinAction, {});
  return (
    <form action={action} className="zform" key={state.error}>
      <input type="hidden" name="token" value={token} />
      <div className="zfield full">
        <label htmlFor="email">Email</label>
        <input id="email" value={email} readOnly autoComplete="username" />
      </div>
      <div className="zfield full">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" required defaultValue={state.name} />
      </div>
      <div className="zfield full">
        <label htmlFor="password">Choose a password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <span className="hint">At least 12 characters.</span>
      </div>
      {state.error && <p className="zerror" role="alert">{state.error}</p>}
      <button type="submit" className="zbtn zbtn-main" disabled={pending}>{pending ? "Joining…" : "Join the team"}</button>
    </form>
  );
}
