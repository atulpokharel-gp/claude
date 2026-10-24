"use client";

import { useActionState } from "react";
import { createClientAction } from "../actions.ts";

export function NewClientForm() {
  const [state, action, pending] = useActionState(createClientAction, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="form" key={JSON.stringify(v)}>
      <label>
        Company name
        <input name="name" required maxLength={200} defaultValue={v.name} />
      </label>
      <label>
        <span>Industry <span className="muted">(optional)</span></span>
        <input name="industry" maxLength={200} defaultValue={v.industry} />
      </label>
      <div className="form-row">
        <label>
          Staff
          <input name="staff" type="number" min={0} inputMode="numeric" defaultValue={v.staff} />
        </label>
        <label>
          Laptops to scan
          <input name="devices" type="number" min={0} inputMode="numeric" defaultValue={v.devices} />
        </label>
      </div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" className="btn primary" disabled={pending}>{pending ? "Adding…" : "Add client"}</button>
    </form>
  );
}
