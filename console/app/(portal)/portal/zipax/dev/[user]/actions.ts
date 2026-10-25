"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session.ts";
import {
  DIMENSIONS,
  type Dimension,
  getPrefs,
  newPublicSlug,
  ZIPAX_DEV_COOKIE,
  ZipaxError,
  readDevIdentity,
  savePrefs,
} from "@/lib/zipax.ts";

const HASH_RE = /^[0-9a-f]{16,64}$/;
const DIM_SET = new Set<string>(DIMENSIONS);

/**
 * Writes the public-profile preferences for one user_hash inside the
 * viewer's own client. Picking a dimension from the form opts in to that
 * dimension on the public page; unchecking it opts out.
 */
export async function savePublicProfileAction(formData: FormData): Promise<void> {
  const s = await requireViewer();
  const userHash = String(formData.get("userHash") ?? "").toLowerCase();
  if (!HASH_RE.test(userHash)) return;
  // Only the developer who claimed this user_hash can edit its prefs.
  const jar = await cookies();
  const dev = readDevIdentity(jar.get(ZIPAX_DEV_COOKIE)?.value);
  if (!dev || dev.mspId !== s.mspId || dev.userHash !== userHash) {
    throw new ZipaxError("You can edit only your own profile. Claim this user_hash via your laptop's Zipax CLI first.", 403);
  }
  const displayName = String(formData.get("displayName") ?? "").slice(0, 120);
  const action = String(formData.get("action") ?? "");
  const tenant = { mspId: s.mspId, clientId: s.clientId };
  if (action === "disable") {
    await savePrefs(tenant, userHash, { displayName, publicSlug: null, publicDims: [] });
    revalidatePath(`/portal/zipax/dev/${userHash}`);
    return;
  }
  const dims = Array.from(formData.getAll("dim"))
    .map((d) => String(d))
    .filter((d): d is Dimension => DIM_SET.has(d));
  const existing = await getPrefs(tenant, userHash);
  const slug = existing?.publicSlug ?? newPublicSlug();
  await savePrefs(tenant, userHash, { displayName, publicSlug: slug, publicDims: dims });
  revalidatePath(`/portal/zipax/dev/${userHash}`);
}
