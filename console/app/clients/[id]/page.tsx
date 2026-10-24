import Link from "next/link";
import { notFound } from "next/navigation";
import { clients, getClient } from "@/lib/sample-data.ts";
import { ClientView } from "@/components/ClientView.tsx";

export function generateStaticParams() {
  return clients.map((c) => ({ id: c.id }));
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getClient(id);
  if (!client) notFound();
  return (
    <>
      <p className="small"><Link href="/">← All clients</Link></p>
      <ClientView client={client} />
    </>
  );
}
