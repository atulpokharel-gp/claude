"use client";

import { useActionState, useState } from "react";
import {
  changePasswordAction,
  disableTotpAction,
  enableTotpAction,
  inviteAction,
  removeMemberAction,
  startTotpAction,
  type TotpSetup,
} from "./actions.ts";

function Result({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (state.ok) return <p className="form-ok" role="status">{state.ok}</p>;
  return null;
}

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [enableState, enable, enabling] = useActionState(enableTotpAction, {});
  const [disableState, disable, disabling] = useActionState(disableTotpAction, {});

  if (enabled) {
    return (
      <form action={disable} className="form">
        <p>Two-factor sign-in is <b>on</b>.</p>
        <label>
          Your password, to turn it off
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <Result state={disableState} />
        <button className="btn" type="submit" disabled={disabling}>Turn off two-factor sign-in</button>
      </form>
    );
  }
  if (enableState.ok) return <Result state={enableState} />;
  if (!setup?.secret) {
    return (
      <div className="form">
        <p>Add a code from an authenticator app (such as Microsoft Authenticator, Google Authenticator or 1Password) to every sign-in.</p>
        {setup?.error && <p className="form-error" role="alert">{setup.error}</p>}
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setSetup(await startTotpAction());
            } finally {
              setBusy(false);
            }
          }}
        >
          Set up two-factor sign-in
        </button>
      </div>
    );
  }
  return (
    <form action={enable} className="form">
      <p>Scan this with your authenticator app, then type the 6-digit code it shows.</p>
      <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr ?? "" }} />
      <p className="small">Can't scan? Enter this key: <code>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
      <label>
        Code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
      </label>
      <Result state={enableState} />
      <button className="btn primary" type="submit" disabled={enabling}>Turn on</button>
    </form>
  );
}

export function ChangePassword() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="form" key={state.ok}>
      <div className="form-row">
        <label>
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password <span className="muted">(12+ characters)</span>
          <input name="next" type="password" autoComplete="new-password" minLength={12} required />
        </label>
      </div>
      <Result state={state} />
      <button className="btn" type="submit" disabled={pending}>Change password</button>
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, {});
  return (
    <>
      <form action={action} className="form inline">
        <label>
          Invite a teammate by email
          <input name="email" type="email" required defaultValue={state.link ? "" : state.email} key={state.link ?? state.email} />
        </label>
        <button className="btn primary" type="submit" disabled={pending}>Create invite link</button>
        <Result state={state} />
      </form>
      {state.link && (
        <div className="token-once">
          <p><b>Send this link to {state.email}.</b> It works once, for 7 days, and is shown only now.</p>
          <code className="block">{state.link}</code>
        </div>
      )}
    </>
  );
}

export function RemoveMember({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(removeMemberAction, {});
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return <button className="btn small" type="button" onClick={() => setConfirm(true)}>Remove</button>;
  }
  return (
    <form action={action} className="actions">
      <input type="hidden" name="id" value={id} />
      <span className="small">Remove {name}?</span>
      <button className="btn small danger" type="submit" disabled={pending}>Yes, remove</button>
      <button className="btn small" type="button" onClick={() => setConfirm(false)}>Cancel</button>
      {state.error && <span className="form-error">{state.error}</span>}
    </form>
  );
}
