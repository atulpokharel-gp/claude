import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPortal } from "@/lib/data.ts";
import { ClientReport } from "@/components/ClientReport.tsx";
import { PrintButton } from "@/app/(console)/app/clients/[id]/report/PrintButton.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report" };

export default async function PortalReport() {
  const data = await loadPortal(1);
  if (!data) notFound();
  return (
    <>
      <div className="no-print actions">
        <Link href="/portal" className="small">← Back to overview</Link>
        <span style={{ flex: 1 }} />
        <PrintButton />
      </div>
      <ClientReport client={data.client} mspName={data.mspName} m365={data.m365} demo={false} />
    </>
  );
}
