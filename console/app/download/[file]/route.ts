// GET /download/<file>: sends laptops to the published scanner build.
// The RMM install scripts download from here so they only need the console's
// address.

import { downloadUrl } from "@/lib/downloads.ts";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const url = downloadUrl(file);
  if (!url) return new Response("Not found", { status: 404 });
  return Response.redirect(url, 302);
}
