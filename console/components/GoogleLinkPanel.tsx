import type { GoogleLink } from "@/lib/identities.ts";
import { unlinkGoogleAction } from "@/app/(console)/app/settings/actions.ts";

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  linked: { text: "Linked. You can now sign in with Google.", ok: true },
  taken: { text: "That Google account is already linked to another Zinloop login.", ok: false },
  failed: { text: "Google sign-in didn't work. Try again.", ok: false },
  cancelled: { text: "Linking was cancelled.", ok: false },
};

/** Link or unlink the user's Google account for "Sign in with Google". */
export function GoogleLinkPanel({ link, available, notice }: { link: GoogleLink | null; available: boolean; notice?: string }) {
  if (!available && !link) return null;
  const n = notice ? NOTICE[notice] : undefined;
  return (
    <section className="panel" id="google">
      <div className="panel-head"><h2>Sign in with Google</h2></div>
      <div className="panel-body form">
        {n && <p className={n.ok ? "form-ok" : "form-error"} role="status">{n.text}</p>}
        {link ? (
          <>
            <p>Linked to <b>{link.label || "a Google account"}</b>. Your password still works too.</p>
            <form action={unlinkGoogleAction}><button className="btn" type="submit">Unlink</button></form>
          </>
        ) : (
          <>
            <p>Use your Google account to sign in. If you have two-factor sign-in on, you&apos;ll still be asked for your code.</p>
            <form method="post" action="/api/auth/google/start">
              <input type="hidden" name="mode" value="link" />
              <button className="btn" type="submit">Link Google account</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
