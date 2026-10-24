import type { MicrosoftLink } from "@/lib/identities.ts";
import { unlinkMicrosoftAction } from "@/app/(console)/app/settings/actions.ts";

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  linked: { text: "Linked. You can now sign in with Microsoft.", ok: true },
  taken: { text: "That Microsoft account is already linked to another Zinloop login.", ok: false },
  failed: { text: "Microsoft sign-in didn't work. Try again.", ok: false },
  cancelled: { text: "Linking was cancelled.", ok: false },
};

/** Link or unlink the user's Microsoft work account for "Sign in with Microsoft". */
export function MicrosoftLinkPanel({ link, available, notice }: { link: MicrosoftLink | null; available: boolean; notice?: string }) {
  if (!available && !link) return null;
  const n = notice ? NOTICE[notice] : undefined;
  return (
    <section className="panel" id="microsoft">
      <div className="panel-head"><h2>Sign in with Microsoft</h2></div>
      <div className="panel-body form">
        {n && <p className={n.ok ? "form-ok" : "form-error"} role="status">{n.text}</p>}
        {link ? (
          <>
            <p>Linked to <b>{link.label || "a Microsoft work account"}</b>. Your password still works too.</p>
            <form action={unlinkMicrosoftAction}><button className="btn" type="submit">Unlink</button></form>
          </>
        ) : (
          <>
            <p>Use your Microsoft work account to sign in. If you have two-factor sign-in on, you&apos;ll still be asked for your code.</p>
            <form method="post" action="/api/auth/microsoft/start">
              <input type="hidden" name="mode" value="link" />
              <button className="btn" type="submit">Link Microsoft account</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
