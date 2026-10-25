"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  DIMENSIONS,
  type Dimension,
  getPrefs,
  newPublicSlug,
  PAXEL_DEV_COOKIE,
  PaxelError,
  readDevIdentity,
  savePrefs,
} from "@/lib/paxel.ts";

const DIM_SET = new Set<string>(DIMENSIONS);

/**
 * Writes the public-profile preferences for the developer whose paxel_dev
 * cookie is on this request. The cookie is the authority — no viewer login
 * is required, and no other user_hash can be edited from here.
 */
export async function savePaxelSettingsAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const dev = readDevIdentity(jar.get(PAXEL_DEV_COOKIE)?.value);
  if (!dev) {
    throw new PaxelError(
      "You're not claimed on this browser. Run `zinloop paxel` on your laptop and open the printed /paxel/claim URL.",
      403,
    );
  }
  const displayName = String(formData.get("displayName") ?? "").slice(0, 120);
  const action = String(formData.get("action") ?? "");
  const tenant = { mspId: dev.mspId, clientId: dev.clientId };
  if (action === "disable") {
    await savePrefs(tenant, dev.userHash, { displayName, publicSlug: null, publicDims: [] });
    revalidatePath("/paxel/settings");
    return;
  }
  const dims = Array.from(formData.getAll("dim"))
    .map((d) => String(d))
    .filter((d): d is Dimension => DIM_SET.has(d));
  const existing = await getPrefs(tenant, dev.userHash);
  const slug = existing?.publicSlug ?? newPublicSlug();
  await savePrefs(tenant, dev.userHash, { displayName, publicSlug: slug, publicDims: dims });
  revalidatePath("/paxel/settings");
}

/** Clears the paxel_dev cookie. The next `zinloop paxel` run + /paxel/claim rebinds. */
export async function signOutPaxelDevAction(): Promise<void> {
  const jar = await cookies();
  jar.set(PAXEL_DEV_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  revalidatePath("/paxel/settings");
}
