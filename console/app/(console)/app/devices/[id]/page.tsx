import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDeviceById } from "@/lib/device-inventory.ts";
import { RiskPill } from "@/components/RiskPill.tsx";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Device security details · Zinloop"};
const fmt=(iso:string|null)=>iso?new Date(iso).toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"}):"No scan received";
export default async function DeviceDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const d=await loadDeviceById(id);
  if(!d) notFound();
  return <>
    <div className="page-head">
      <p className="small"><Link href="/app/devices">← All devices</Link>{" · "}<Link href={"/app/clients/"+d.clientId}>{d.clientName}</Link></p>
      <div className="endpoint-headrow">
        <div><h1>{d.hostname}</h1><p className="muted">{d.os} · {d.clientName} · Last scan: {fmt(d.lastScan)}</p></div>
        <div className="actions"><Link className="btn" href="/app/downloads">Scanner downloads</Link><Link className="btn" href={"/app/clients/"+d.clientId+"/report"}>Client report</Link></div>
      </div>
    </div>
    {d.demo&&<div className="warning"><b>Demonstration data.</b><p>No real endpoint or customer system is connected.</p></div>}
    {d.incomplete.length>0&&<section className="warning"><h2>Scan incomplete</h2><p>Not all configured resources could be checked. Do not treat missing findings as proof that the device is safe.</p>
      <ul>{d.incomplete.slice(0,20).map((w,i)=><li key={i}>{w}</li>)}</ul></section>}
    <section className="tiles">
      <div className="tile"><b>{d.agents.length}</b><span>MCP servers reported</span></div>
      <div className="tile high"><b>{d.high}</b><span>High-severity findings</span></div>
      <div className="tile"><b>{d.medium}</b><span>Medium-severity findings</span></div>
      <div className="tile"><b>{d.details.configs.length}</b><span>Config locations checked</span></div>
      <div className="tile"><b>{d.details.tools.length}</b><span>Runtime tools observed</span></div>
      <div className="tile"><b>{d.details.skills.length}</b><span>Skills discovered</span></div>
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Scan details</h2></div>
      <div className="endpoint-metadata">
        <div><span>Scanner version</span><strong>{d.scannerVersion||"Not reported"}</strong></div>
        <div><span>Scan completeness</span><strong>{d.incomplete.length?"Incomplete":d.lastScan?"Reported":"Not scanned"}</strong></div>
        <div><span>Device status</span><strong>{d.status.replaceAll("-"," ")}</strong></div>
        <div><span>AI applications found</span><strong>{d.applications.join(", ")||"None reported"}</strong></div>
      </div>
    </section>
    <nav className="endpoint-section-nav" aria-label="Device report sections">
      <a href="#servers">MCP servers</a><a href="#configs">Configuration files</a><a href="#tools">Tools and probes</a>
      <a href="#skills">Skills</a><a href="#warnings">Path warnings</a><a href="#remediation">Fixes</a>
    </nav>
    <section className="panel" id="servers">
      <div className="panel-head"><h2>MCP servers and findings</h2><span className="muted small">Names, scopes and credential *names* only; no raw keys</span></div>
      {d.details.servers.length===0 && d.agents.length===0 ? <p className="empty">No MCP servers reported in the latest scan.</p> : (
        <div className="endpoint-cards">
          {(d.details.servers.length?d.details.servers:d.agents.map(a=>({
            name:a.name,app:a.app,configPath:a.configPath||"",scope:"",transport:"unknown",disabled:false,
            risk:a.findings.some(f=>f.severity==="high")?"high" as const:a.findings.some(f=>f.severity==="medium")?"medium" as const:"none" as const,
            envKeys:[],headerKeys:[],protectedKeys:a.protectedKeys||[],findings:a.findings
          }))).map((s,i)=><article className="endpoint-server" key={i}>
            <div className="endpoint-headrow">
              <div><h3>{s.name}</h3><p className="muted small">{s.app} · {s.transport||"Transport unspecified"}{s.disabled?" · Disabled":""}</p></div>
              <RiskPill risk={s.risk}/>
            </div>
            <dl className="endpoint-dl">
              <div><dt>Config path</dt><dd>{s.configPath||"Not reported"}</dd></div>
              <div><dt>Scope</dt><dd>{s.scope||"User/global"}</dd></div>
              <div><dt>Environment variables</dt><dd>{s.envKeys.join(", ")||"None listed"}</dd></div>
              <div><dt>Header names</dt><dd>{s.headerKeys.join(", ")||"None listed"}</dd></div>
              <div><dt>OS password store</dt><dd>{s.protectedKeys.join(", ")||"No protected keys reported"}</dd></div>
            </dl>
            {s.findings.length>0?<div className="endpoint-findings">{s.findings.map((f,j)=><div key={j} className="endpoint-finding">
              <RiskPill risk={f.severity}/><div><b>{f.title}</b><div className="muted small">Rule: {f.ruleId}</div></div>
            </div>)}</div>:<p className="muted small">No findings from this server in the available scan. That does not establish safety beyond the checks performed.</p>}
          </article>)}
        </div>
      )}
    </section>
    <section className="panel" id="configs">
      <div className="panel-head"><h2>Configuration discovery</h2></div>
      {d.details.configs.length===0?<p className="empty">Config-location details not present in this scan.</p>:
      <div className="table-wrap"><table><thead><tr><th>Application</th><th>Path</th><th>Found</th><th>Servers</th><th>Result</th></tr></thead>
      <tbody>{d.details.configs.map((c,i)=><tr key={i}><td>{c.app}</td><td className="small">{c.path}</td><td>{c.found?"Yes":"No"}</td><td>{c.servers}</td><td>{c.error||"Checked"}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel" id="tools">
      <div className="panel-head"><h2>Runtime tool inventory and probes</h2></div>
      <div className="panel-body"><p className="muted small">Tool lists are available only when a scan explicitly probes a server. Probing can launch third-party processes and is not part of the offline default scan.</p>
        {d.details.probes.map((p,i)=><div key={i} className="endpoint-finding"><span className="endpoint-status">{p.server}</span><span>{p.error||String(p.count)+" tools listed"}</span></div>)}
      </div>
      {d.details.tools.length>0?<div className="table-wrap"><table><thead><tr><th>Server</th><th>Advertised tool</th><th>Risk</th><th>Findings</th></tr></thead>
      <tbody>{d.details.tools.map((t,i)=><tr key={i}><td>{t.server}</td><td><b>{t.name}</b></td><td><RiskPill risk={t.risk}/></td><td>{t.findings.map(f=>f.title).join("; ")||"No listed findings"}</td></tr>)}</tbody></table></div>:<p className="empty">No runtime tool details available.</p>}
    </section>
    <section className="panel" id="skills">
      <div className="panel-head"><h2>Discovered agent skills</h2></div>
      {d.details.skills.length>0?<div className="table-wrap"><table><thead><tr><th>Skill</th><th>Source</th><th>Risk</th><th>Findings</th></tr></thead>
      <tbody>{d.details.skills.map((s,i)=><tr key={i}><td>{s.name}</td><td>{s.source}</td><td><RiskPill risk={s.risk}/></td><td>{s.findings.map(f=>f.title).join("; ")||"No listed findings"}</td></tr>)}</tbody></table></div>:<p className="empty">No agent skills reported.</p>}
    </section>
    <section className="panel" id="warnings">
      <div className="panel-head"><h2>Suspicious configuration paths</h2></div>
      {d.details.pathWarnings.length>0?<div className="panel-body">
        {d.details.pathWarnings.map((p,i)=><div key={i} className="endpoint-finding">
          <span className="endpoint-status attention">{p.severity}</span><div><b>{p.app}</b><p className="muted small">{p.detail}</p></div>
        </div>)}
      </div>:<p className="empty">No path warnings reported. This is limited to paths the scanner checked.</p>}
    </section>
    <section className="panel" id="remediation">
      <div className="panel-head"><h2>Recommended next actions</h2></div>
      <div className="panel-body">
        <p>Perform local credential fixes on the endpoint, using an authorized technician account. Scans themselves are read-only.</p>
        <pre className="endpoint-code">zinloop fix-secrets{"\n"}zinloop fix-secrets --apply{"\n"}zinloop rotate --list{"\n"}zinloop --json --out scan.json</pre>
        <p className="muted small">Keychain migration protects local storage but does not revoke a previously exposed credential. Rotate or revoke at the provider, and scan again to verify the change.</p>
      </div>
    </section>
  </>;
}