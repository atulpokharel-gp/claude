import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadClient } from "@/lib/data.ts";
import { ClientView } from "@/components/ClientView.tsx";
import { ConnectLaptops } from "@/components/ConnectLaptops.tsx";

export const dynamic = "force-dynamic";

async function consoleUrl(): Promise<string> {
  if (process.env.CONSOLE_URL) return process.env.CONSOLE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadClient(id);
  if (!detail) notFound();
  return (
    <>
      <p className="small"><Link href="/app">← All clients</Link></p>
      <ClientView client={detail.client} reportHref={`/app/clients/${detail.client.id}/report`} />
      {!detail.demo && <ConnectLaptops clientId={detail.client.id} tokens={detail.tokens} consoleUrl={await consoleUrl()} />}
    </>
  );
}
