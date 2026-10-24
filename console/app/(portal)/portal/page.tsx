import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPortal } from "@/lib/data.ts";
import { ClientView } from "@/components/ClientView.tsx";
import { TrendChart } from "@/components/TrendChart.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function PortalHome() {
  const data = await loadPortal();
  if (!data) notFound();
  const hasTrend = data.trend.length >= 2 && data.trend.some((p) => p.tools > 0);
  return (
    <>
      <div className="page-head">
        <h1>Your AI security</h1>
        <p className="muted">AI tools at your company, checked by {data.mspName}. This view is read-only; {data.mspName} makes the fixes.</p>
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Risk over the last 90 days</h2></div>
        <div className="panel-body">
          {hasTrend ? <TrendChart points={data.trend} /> : <p className="empty">The chart fills in as laptops report and Microsoft 365 is checked, one point a day.</p>}
        </div>
      </section>
      <ClientView client={data.client} reportHref="/portal/report" readOnly />
    </>
  );
}
