"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Client, Severity } from "@/lib/types.ts";
import { RiskPill } from "@/components/RiskPill.tsx";

type Row={key:string; clientId:string;clientName:string;agentName:string;host:string;app:string;source:string;rule:string;severity:Severity;title:string;detail:string;fix:string};
export function FindingsExplorer({clients}:{clients:Client[]}) {
  const rows=useMemo(()=>clients.flatMap(c=>c.agents.flatMap(a=>a.findings.map((f,i)=>({
    key:c.id+"/"+a.id+"/"+i,clientId:c.id,clientName:c.name,agentName:a.name,host:a.location,app:a.app,source:a.source,
    rule:f.ruleId,severity:f.severity,title:f.title,detail:f.detail,fix:f.fix
  })))),[clients]);
  const [q,setQ]=useState("");
  const [sev,setSev]=useState("all");
  const [client,setClient]=useState("all");
  const [selected,setSelected]=useState<string|null>(null);
  const filtered=useMemo(()=>rows.filter(r=>
    (sev==="all"||r.severity===sev)&&(client==="all"||r.clientId===client)&&
    (r.title+" "+r.rule+" "+r.agentName+" "+r.clientName+" "+r.host).toLowerCase().includes(q.toLowerCase())
  ),[rows,q,sev,client]);
  const chosen=rows.find(r=>r.key===selected);
  return <>
    <section className="tiles">
      <div className="tile"><b>{rows.length}</b><span>Individual findings</span></div>
      <div className="tile high"><b>{rows.filter(r=>r.severity==="high").length}</b><span>High severity</span></div>
      <div className="tile"><b>{rows.filter(r=>r.severity==="medium").length}</b><span>Medium severity</span></div>
      <div className="tile"><b>{new Set(rows.map(r=>r.clientId)).size}</b><span>Clients affected</span></div>
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Security findings</h2><span className="muted small">{filtered.length} matching results</span></div>
      <div className="endpoint-toolbar">
        <input aria-label="Search findings" type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by rule, server, client or device…"/>
        <select aria-label="Client" value={client} onChange={e=>setClient(e.target.value)}>
          <option value="all">All clients</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Severity" value={sev} onChange={e=>setSev(e.target.value)}>
          <option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Finding</th><th>Client</th><th>AI tool / MCP server</th><th>Source</th><th>Review</th></tr></thead>
        <tbody>{filtered.map(r=><tr key={r.key}>
          <td><RiskPill risk={r.severity}/></td><td><b>{r.title}</b><div className="muted small">{r.rule}</div></td>
          <td><Link href={"/app/clients/"+r.clientId}>{r.clientName}</Link></td><td><b>{r.agentName}</b><div className="muted small">{r.app} · {r.host}</div></td>
          <td className="muted small">{r.source}</td><td><button type="button" className="btn small" onClick={()=>setSelected(r.key)}>Details</button></td>
        </tr>)}</tbody>
      </table></div>
      {filtered.length===0&&<p className="empty">No findings match your filters.</p>}
    </section>
    {chosen&&<section className="panel" aria-label="Finding details" id="finding-detail">
      <div className="panel-head"><h2>Finding details</h2><button className="btn small" type="button" onClick={()=>setSelected(null)}>Close</button></div>
      <div className="panel-body">
        <div className="endpoint-headrow"><h3>{chosen.title}</h3><RiskPill risk={chosen.severity}/></div>
        <p className="muted small">Rule {chosen.rule} · {chosen.clientName} · {chosen.agentName}</p>
        <h3>What Zinloop found</h3><p>{chosen.detail||"No further evidence was included in the available report."}</p>
        <h3>Recommended action</h3><p>{chosen.fix||"Review the MCP configuration and apply your organization's security policy."}</p>
        <p className="muted small">Confirm the fix with a subsequent scan. A finding is not a confirmed compromise.</p>
        <div className="actions"><Link className="btn primary" href={"/app/clients/"+chosen.clientId}>Open client</Link></div>
      </div>
    </section>}
  </>;
}