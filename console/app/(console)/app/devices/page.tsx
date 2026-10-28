import type { Metadata } from "next";
import Link from "next/link";
import { loadDevices } from "@/lib/device-inventory.ts";
import { DeviceInventory } from "@/components/DeviceInventory.tsx";
export const metadata: Metadata = {title:"Devices · Zinloop Security"};
export const dynamic = "force-dynamic";
export default async function DevicesPage() {
  const devices=await loadDevices();
  return <>
    <div className="page-head">
      <div className="endpoint-headrow">
        <div><h1>Managed devices</h1><p className="muted">Every endpoint that has reported to Zinloop, across all authorized clients.</p></div>
        <div className="actions"><Link className="btn" href="/app/downloads">Get scanner</Link><Link className="btn primary" href="/app/import">Inspect local scan file</Link></div>
      </div>
    </div>
    <DeviceInventory devices={devices}/>
  </>;
}