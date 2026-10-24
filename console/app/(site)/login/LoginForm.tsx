"use client";

import { useActionState } from "react";
import { mfaAction, signInAction } from "./actions.ts";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, {});
  return (
    <form action={action} className="zform">
      <div className="zfield full">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} key={state.email} />
      </div>
      <div className="zfield full">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="zerror" role="alert">{state.error}</p>}
      <button type="submit" className="zbtn zbtn-main" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function MfaForm() {
  const [state, action, pending] = useActionState(mfaAction, {});
  return (
    <form action={action} className="zform">
      <div className="zfield full">
        <label htmlFor="code">6-digit code from your authenticator app</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
      </div>
      {state.error && <p className="zerror" role="alert">{state.error}</p>}
      <button type="submit" className="zbtn zbtn-main" disabled={pending}>{pending ? "Checking…" : "Continue"}</button>
    </form>
  );
}
