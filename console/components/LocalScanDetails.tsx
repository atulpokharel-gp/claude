"use client";
// Safe supplementary views for a locally opened scan.json file.
// Do not display raw config values, tool descriptions, command arguments or URLs.
type Item=Record<string,unknown>;
const asItems=(v:unknown):Item[]=>Array.isArray(v)?v.filter((x):x is Item=>x!==null&&typeof x==="object"&&!Array.isArray(x)).slice(0,500):[];
const asText=(v:unknown):string=>typeof v==="string"?v.slice(0,220):"";
function Section({title,count,children}:{title:string;count:number;children:React.ReactNode}){
  return <section className="panel"><div className="panel-head"><h2>{title}</h2><span className="muted small">{count} reported</span></div>{count?children:<p className="empty">No {title.toLowerCase()} included in this report.</p>}</section>;
}
export function LocalScanDetails({report}:{report:unknown}) {
  if(!report||typeof report!=="object"||Array.isArray(report))return null;
  const r=report as Item;
  const configs=asItems(r.configs),skills=asItems(r.skills),tools=asItems(r.tools),probes=asItems(r.toolProbes),warnings=asItems(r.pathWarnings);
  return <div className="local-scan-details">
    <div className="page-head"><h2>Complete local scan overview</h2><p className="muted">These sections are read only from your local file. Only explicitly selected metadata is displayed; no secrets, arguments or tool-description bodies are rendered.</p></div>
    <section className="tiles">
      <div className="tile"><b>{asText(r.scannerVersion)||"Unknown"}</b><span>Scanner version</span></div>
      <div className="tile"><b>{configs.length}</b><span>Config locations</span></div>
      <div className="tile"><b>{skills.length}</b><span>Agent skills</span></div>
      <div className="tile"><b>{tools.length}</b><span>Runtime tools</span></div>
      <div className="tile"><b>{warnings.length}</b><span>Path warnings</span></div>
    </section>
    <Section title="Configuration locations" count={configs.length}>
      <div className="table-wrap"><table><thead><tr><th>App</th><th>Config file</th><th>Located</th><th>Servers</th><th>Read status</th></tr></thead><tbody>
        {configs.map((c,i)=><tr key={i}><td>{asText(c.app)}</td><td className="small">{asText(c.path)}</td><td>{c.found?"Yes":"No"}</td><td>{typeof c.servers==="number"?c.servers:0}</td><td>{c.error?"Could not read":"Checked"}</td></tr>)}
      </tbody></table></div>
    </Section>
    <Section title="Agent skills" count={skills.length}>
      <div className="table-wrap"><table><thead><tr><th>Skill</th><th>Source</th><th>Risk</th><th>Rule findings</th></tr></thead><tbody>
        {skills.map((s,i)=><tr key={i}><td>{asText(s.name)}</td><td>{asText(s.source)}</td><td>{asText(s.risk)}</td><td>{asItems(s.findings).map(f=>asText(f.ruleId)).filter(Boolean).join(", ")||"None"}</td></tr>)}
      </tbody></table></div>
    </Section>
    <Section title="Runtime MCP tools" count={tools.length}>
      <div className="table-wrap"><table><thead><tr><th>Server</th><th>Tool</th><th>Risk</th><th>Rule findings</th></tr></thead><tbody>
        {tools.map((t,i)=><tr key={i}><td>{asText(t.server)}</td><td>{asText(t.name)}</td><td>{asText(t.risk)}</td><td>{asItems(t.findings).map(f=>asText(f.ruleId)).filter(Boolean).join(", ")||"None"}</td></tr>)}
      </tbody></table></div>
    </Section>
    <Section title="Tool probes" count={probes.length}>
      <div className="table-wrap"><table><thead><tr><th>Server</th><th>Tools listed</th><th>Status</th></tr></thead><tbody>
        {probes.map((p,i)=><tr key={i}><td>{asText(p.server)}</td><td>{typeof p.tools==="number"?p.tools:0}</td><td>{p.error?"Probe failed or was refused":"Completed"}</td></tr>)}
      </tbody></table></div>
    </Section>
    <Section title="Path warnings" count={warnings.length}>
      <div className="table-wrap"><table><thead><tr><th>App</th><th>Reason</th><th>Severity</th></tr></thead><tbody>
        {warnings.map((w,i)=><tr key={i}><td>{asText(w.app)}</td><td>{asText(w.reason).replaceAll("_"," ")}</td><td>{asText(w.severity)}</td></tr>)}
      </tbody></table></div>
    </Section>
  </div>;
}