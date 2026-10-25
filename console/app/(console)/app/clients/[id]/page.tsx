import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadClient } from "@/lib/data.ts";
import { ClientView } from "@/components/ClientView.tsx";
import { ConnectLaptops } from "@/components/ConnectLaptops.tsx";
import { M365Panel } from "@/components/M365Panel.tsx";
import { ClientLogins } from "@/components/ClientLogins.tsx";
import { hasM365 } from "@/lib/m365.ts";
import { revokeM365Action } from "../m365-actions.ts";

export const dynamic = "force-dynamic";

async function consoleUrl(): Promise<string> {
  if (process.env.CONSOLE_URL) return process.env.CONSOLE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m365?: string }>;
}) {
  const { id } = await params;
  const { m365: notice } = await searchParams;
  const detail = await loadClient(id);
  if (!detail) notFound();
  return (
    <>
      <p className="small">
        <Link href="/app">← All clients</Link>
        {!detail.demo && (
          <>
            {" "}·{" "}
            <Link href={`/app/clients/${detail.client.id}/changes`}>What's changed</Link>
          </>
        )}
      </p>
      <ClientView
        client={detail.client}
        reportHref={`/app/clients/${detail.client.id}/report`}
        onRevoke={detail.demo ? undefined : revokeM365Action.bind(null, detail.client.id)}
      />
      {!detail.demo && <M365Panel clientId={detail.client.id} status={detail.m365} available={hasM365()} notice={notice} />}
      {!detail.demo && <ConnectLaptops clientId={detail.client.id} tokens={detail.tokens} consoleUrl={await consoleUrl()} />}
      {!detail.demo && <ClientLogins clientId={detail.client.id} clientName={detail.client.name} logins={detail.logins} isOwner={detail.isOwner} />}
    </>
  );
}
