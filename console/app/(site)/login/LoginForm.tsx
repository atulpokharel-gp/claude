"use client";

import { useActionState } from "react";
import { signInAction } from "./actions.ts";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, {});
  return (
    <form action={action} className="form">
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required defaultValue={state.email} key={state.email} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" className="btn" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
