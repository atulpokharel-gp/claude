import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClient } from "@/lib/data.ts";
import { loadDevices } from "@/lib/device-inventory.ts";
import { DeviceInventory } from "@/components/DeviceInventory.tsx";
export const dynamic="force-dynamic";
export const metadata: Metadata = {title:"Client devices · Zinloop"};
export default async function ClientDevices({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const info=await loadClient(id);
  if(!info) notFound();
  const devices=await loadDevices(id);
  return <>
    <div className="page-head"><p className="small"><Link href={"/app/clients/"+id}>← {info.client.name}</Link></p><h1>Client devices</h1><p className="muted">Installed scanners, latest reports, scan completeness and MCP security findings for {info.client.name}.</p></div>
    <DeviceInventory devices={devices} clientFixed/>
    {info.demo&&<p className="muted small">Demo endpoints are derived from synthetic sample reports; this inventory does not represent all expected customer laptops.</p>}
  </>;
}