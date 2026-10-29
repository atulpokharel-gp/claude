"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { classifyAccount, orgNameFromDomain } from "@/lib/email-kind.ts";
import { signUpAction } from "./actions.ts";

export function SignUpForm({ partner }: { partner: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, {});
  const v = state.values;
  const [email, setEmail] = useState(v?.email ?? "");
  const [mspName, setMspName] = useState(v?.mspName ?? "");
  const [mspTouched, setMspTouched] = useState(Boolean(v?.mspName));

  // Detected only once there's a plausible address, so we don't flash "organization" mid-typing.
  const kind = useMemo(() => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? classifyAccount(email) : null), [email]);
  const isIndividual = kind === "individual";

  function onEmail(next: string) {
    setEmail(next);
    if (mspTouched) return;
    // Autofill a company suggestion for org domains; clear it for individuals.
    const suggestion = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) ? orgNameFromDomain(next) : "";
    setMspName(suggestion);
  }

  return (
    <form action={action} className="zform" key={state.error}>
      <div className="zfield">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" required defaultValue={v?.name} />
      </div>
      <div className="zfield">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => onEmail(e.target.value)} />
        {kind && (
          <span className="hint">
            {isIndividual ? "We'll set this up as an individual account." : "We'll set this up as an organization account."}
          </span>
        )}
      </div>
      <div className="zfield">
        <label htmlFor="mspName">{isIndividual ? "Company name (optional)" : "Company name"}</label>
        <input
          id="mspName"
          name="mspName"
          autoComplete="organization"
          required={!isIndividual}
          value={mspName}
          onChange={(e) => { setMspName(e.target.value); setMspTouched(true); }}
          placeholder={isIndividual ? "Leave blank for a personal account" : ""}
        />
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
