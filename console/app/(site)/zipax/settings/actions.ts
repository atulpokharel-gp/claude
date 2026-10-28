"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  DIMENSIONS,
  type Dimension,
  getPrefs,
  newPublicSlug,
  SLUG_MAX,
  SLUG_MIN,
  ZIPAX_DEV_COOKIE,
  ZipaxError,
  readDevIdentity,
  savePrefs,
} from "@/lib/zipax.ts";

const DIM_SET = new Set<string>(DIMENSIONS);
const SLUG_RE = new RegExp(`^[a-z0-9]{${SLUG_MIN},${SLUG_MAX}}$`);

// Postgres unique_violation. Thrown when the dev picks a slug another dev
// already took.
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Writes the public-profile preferences for the developer whose zipax_dev
 * cookie is on this request. The cookie is the authority — no viewer login
 * is required, and no other user_hash can be edited from here.
 *
 * The slug input is explicit (patch.publicSlug). An empty value preserves
 * whatever's on disk (or auto-generates one on first publish); a non-empty
 * value is lowercased, validated against SLUG_RE, and persisted. Unique
 * collisions and malformed slugs come back as a redirect to the same page
 * with ?error=… so the form can render the message inline.
 *
 * Privacy toggles (migration 018) are read as explicit form values: a
 * missing checkbox means "off" and we persist that; the stored row is not
 * carried over, so the UI's rendered state is the source of truth. Hidden
 * fields on the form (name="toggle" value="submitted") distinguish a form
 * that intentionally omitted a toggle from one that never had it, so an
 * unrelated action (like "disable") does not clobber the dev's choices.
 */
export async function saveZipaxSettingsAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const dev = readDevIdentity(jar.get(ZIPAX_DEV_COOKIE)?.value);
  if (!dev) {
    throw new ZipaxError(
      "You're not claimed on this browser. Run `zinloop zipax` on your laptop and open the printed /zipax/claim URL.",
      403,
    );
  }
  const displayName = String(formData.get("displayName") ?? "").slice(0, 120);
  const action = String(formData.get("action") ?? "");
  const tenant = { mspId: dev.mspId, clientId: dev.clientId };
  if (action === "disable") {
    // Full unpublish: clear slug, dims, and the leaderboard opt-in. Keep
    // the display name so a future re-publish doesn't lose it; the three
    // show_* toggles are left as-is for the same reason.
    await savePrefs(tenant, dev.userHash, {
      displayName,
      publicSlug: null,
      publicDims: [],
      leaderboardOptIn: false,
    });
    revalidatePath("/zipax/settings");
    return;
  }
  const dims = Array.from(formData.getAll("dim"))
    .map((d) => String(d))
    .filter((d): d is Dimension => DIM_SET.has(d));
  const existing = await getPrefs(tenant, dev.userHash);
  const slugRaw = String(formData.get("publicSlug") ?? "").toLowerCase().trim();
  // Empty input keeps whatever is already stored (or auto-generates on the
  // very first publish). A non-empty input must match the shape rule; the
  // DB check constraint is the authority but we validate here first so the
  // user sees a precise error instead of a 500.
  let slug: string;
  if (slugRaw === "") {
    slug = existing?.publicSlug ?? newPublicSlug();
  } else if (!SLUG_RE.test(slugRaw)) {
    redirect(
      `/zipax/settings?error=${encodeURIComponent(
        `Slug must be ${SLUG_MIN}-${SLUG_MAX} lowercase letters or digits.`,
      )}`,
    );
  } else {
    slug = slugRaw;
  }
  try {
    await savePrefs(tenant, dev.userHash, {
      displayName,
      publicSlug: slug,
      publicDims: dims,
      leaderboardOptIn: formData.get("leaderboardOptIn") === "on",
      showDisplayName: formData.get("showDisplayName") === "on",
      showMeanScore: formData.get("showMeanScore") === "on",
      showSessions: formData.get("showSessions") === "on",
    });
  } catch (err) {
    // Next's redirect() throws a special sentinel; rethrow so Next handles
    // it. Anything else is a real error we translate.
    if (isNextRedirect(err)) throw err;
    const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
    if (code === PG_UNIQUE_VIOLATION) {
      redirect(
        `/zipax/settings?error=${encodeURIComponent(
          `"${slug}" is taken. Pick a different slug.`,
        )}`,
      );
    }
    if (err instanceof ZipaxError) {
      redirect(`/zipax/settings?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/zipax/settings");
}

function isNextRedirect(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Clears the zipax_dev cookie. The next `zinloop zipax` run + /zipax/claim rebinds. */
export async function signOutZipaxDevAction(): Promise<void> {
  const jar = await cookies();
  jar.set(ZIPAX_DEV_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  revalidatePath("/zipax/settings");
}
