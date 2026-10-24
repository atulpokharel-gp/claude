import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClient } from "@/lib/data.ts";
import { ClientReport } from "@/components/ClientReport.tsx";
import { PrintButton } from "./PrintButton.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadClient(id);
  if (!detail) notFound();
  return (
    <>
      <div className="no-print actions">
        <Link href={`/app/clients/${id}`} className="small">← Back to {detail.client.name}</Link>
        <span style={{ flex: 1 }} />
        <PrintButton />
      </div>
      <ClientReport client={detail.client} mspName={detail.mspName} m365={detail.m365} demo={detail.demo} />
    </>
  );
}
