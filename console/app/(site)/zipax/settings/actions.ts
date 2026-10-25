"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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

const DIM_SET = new Set<string>(DIMENSIONS);

/**
 * Writes the public-profile preferences for the developer whose zipax_dev
 * cookie is on this request. The cookie is the authority — no viewer login
 * is required, and no other user_hash can be edited from here.
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
    await savePrefs(tenant, dev.userHash, { displayName, publicSlug: null, publicDims: [] });
    revalidatePath("/zipax/settings");
    return;
  }
  const dims = Array.from(formData.getAll("dim"))
    .map((d) => String(d))
    .filter((d): d is Dimension => DIM_SET.has(d));
  const existing = await getPrefs(tenant, dev.userHash);
  const slug = existing?.publicSlug ?? newPublicSlug();
  await savePrefs(tenant, dev.userHash, { displayName, publicSlug: slug, publicDims: dims });
  revalidatePath("/zipax/settings");
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
