"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Endpoint } from "@/lib/device-inventory.ts";

function time(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {dateStyle:"medium", timeStyle:"short"});
}
const STATUS: Record<Endpoint["status"],string> = {
  healthy: "Healthy", attention: "Needs action", stale: "Stale", incomplete: "Incomplete", never: "Never scanned"
};
export function DeviceInventory({devices,clientFixed=false}:{devices:Endpoint[];clientFixed?:boolean}) {
  const [q,setQ] = useState("");
  const [status,setStatus] = useState("all");
  const [client,setClient] = useState("all");
  const clients = useMemo(()=>[...new Map(devices.map(d=>[d.clientId,d.clientName])).entries()], [devices]);
  const shown = useMemo(()=>devices.filter(d=>
    (status==="all"||d.status===status) && (client==="all"||d.clientId===client) &&
    (d.hostname+" "+d.clientName+" "+d.os+" "+d.applications.join(" ")).toLowerCase().includes(q.toLowerCase())
  ),[devices,q,status,client]);
  const high = devices.filter(d=>d.high>0).length;
  const stale = devices.filter(d=>d.status==="stale"||d.status==="never"||d.status==="incomplete").length;
  const active = devices.filter(d=>d.status!=="never" && d.status!=="stale").length;
  return (
    <>
      <section className="tiles" aria-label="Endpoint summary">
        <div className="tile"><b>{devices.length}</b><span>Discovered devices</span></div>
        <div className="tile"><b>{active}</b><span>Reported within 7 days</span></div>
        <div className="tile high"><b>{high}</b><span>Devices with high findings</span></div>
        <div className="tile"><b>{stale}</b><span>Stale, incomplete or never scanned</span></div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Endpoint inventory</h2>
          <span className="muted small">{shown.length} of {devices.length} devices shown</span>
        </div>
        <div className="endpoint-toolbar">
          <label className="sr-only" htmlFor="endpoint-search">Search devices</label>
          <input id="endpoint-search" type="search" placeholder="Search hostname, OS, client or app…" value={q} onChange={e=>setQ(e.target.value)}/>
          {!clientFixed && <select aria-label="Filter client" value={client} onChange={e=>setClient(e.target.value)}>
            <option value="all">All clients</option>
            {clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>}
          <select aria-label="Filter scan status" value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Endpoint</th>{!clientFixed&&<th>Client</th>}<th>OS</th><th>Scan status</th><th>AI apps / MCP servers</th><th>Findings</th><th>Last scan</th><th>Details</th></tr></thead>
            <tbody>
              {shown.map(d=><tr key={d.id}>
                <td><b>{d.hostname}</b><div className="muted small">{d.scannerVersion ? "Scanner " + d.scannerVersion : "Scanner version unavailable"}</div></td>
                {!clientFixed&&<td className="small"><Link href={"/app/clients/"+d.clientId}>{d.clientName}</Link></td>}
                <td className="small">{d.os}</td>
                <td><span className={"endpoint-status "+d.status}>{STATUS[d.status]}</span></td>
                <td><b>{d.agents.length}</b><div className="muted small">{d.applications.slice(0,3).join(", ")||"No AI servers reported"}</div></td>
                <td><span className="endpoint-count high">{d.high} high</span>{" "}<span className="endpoint-count medium">{d.medium} medium</span></td>
                <td className="muted small">{time(d.lastScan)}</td>
                <td><Link className="btn small" href={"/app/devices/"+encodeURIComponent(d.id)}>Inspect</Link></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {shown.length===0&&<p className="empty">No devices match these filters. Change a filter or connect a scanner to a client.</p>}
      </section>
      <p className="muted small">Status uses the latest available scan per endpoint. A scan with unreadable configuration files is marked incomplete; a clean result does not guarantee that every AI application is covered.</p>
    </>
  );
}