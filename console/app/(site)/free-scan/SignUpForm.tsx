"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "./actions.ts";

export function SignUpForm({ partner }: { partner: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, {});
  const v = state.values;
  return (
    <form action={action} className="zform" key={state.error}>
      <div className="zfield">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" required defaultValue={v?.name} />
      </div>
      <div className="zfield">
        <label htmlFor="mspName">Company name</label>
        <input id="mspName" name="mspName" autoComplete="organization" required defaultValue={v?.mspName} />
      </div>
      <div className="zfield">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={v?.email} />
      </div>
      <div className="zfield">
        <label htmlFor="clients">Number of clients you manage</label>
        <input id="clients" name="clients" inputMode="numeric" pattern="[0-9]*" defaultValue={v?.clients} />
      </div>
      <div className="zfield full">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <span className="hint">At least 12 characters. You can turn on two-factor sign-in after.</span>
      </div>
      <label className="check full">
        <input type="checkbox" name="partner" defaultChecked={partner} /> I'd like to be a design partner (90 days free, weekly feedback call)
      </label>
      <label className="check full">
        <input type="checkbox" name="agree" required /> I'll only scan computers my company or my clients have authorized me to manage, and I accept the <Link href="/terms">terms</Link>.
      </label>
      {state.error && <p className="zerror" role="alert">{state.error}</p>}
      <button type="submit" className="zbtn zbtn-main" disabled={pending}>{pending ? "Creating your account…" : "Create my free account"}</button>
    </form>
  );
}
