// Pure helpers for the Zipax split-host routing. Kept in a separate file
// (no node: imports, no DB) so the Edge middleware can import them without
// pulling in the whole zipax.ts module.

/** Canonical host for public developer pages (/p/<slug> and the leaderboard). */
export const ZIPAX_PUBLIC_HOST = "zipax.zinloop.com";

// Slug shape; must match SLUG_RE in zipax.ts and the DB check constraint in
// migration 019. Duplicated as a string literal here so this file stays
// node-free.
const PUBLIC_PROFILE_PATH_RE = /^\/p\/[a-z0-9]{3,32}(?:\/.*)?$/;

/**
 * Decides whether to redirect a request on `host` + `pathname` to the Zipax
 * public host. Returns null to let it pass through, or an absolute URL to
 * redirect to. Used by the Edge middleware; exported here so the decision
 * is unit-testable without faking NextRequest.
 */
export function canonicalPublicProfileRedirect(
  host: string,
  pathname: string,
  search = "",
): string | null {
  const h = host.toLowerCase();
  if (h.startsWith("zipax.")) return null;
  if (!PUBLIC_PROFILE_PATH_RE.test(pathname)) return null;
  return `https://${ZIPAX_PUBLIC_HOST}${pathname}${search}`;
}
