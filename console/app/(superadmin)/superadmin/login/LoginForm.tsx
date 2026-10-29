"use client";

import { useActionState } from "react";
import { superadminLoginAction } from "./actions.ts";

export function SuperadminLoginForm() {
  const [state, action, pending] = useActionState(superadminLoginAction, {});
  return (
    <form action={action} className="sa-form">
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="sa-error" role="alert">{state.error}</p>}
      <button type="submit" className="sa-btn" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
