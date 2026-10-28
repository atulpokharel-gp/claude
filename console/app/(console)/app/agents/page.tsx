import type { Metadata } from "next";
import Link from "next/link";
import { controlPlaneOverview } from "@/lib/cp-dashboard.ts";
import { AgentControlForms } from "@/components/AgentControlForms.tsx";
import { controlToggleAction } from "./actions.ts";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Agent Control Plane · Zinloop Security"};
const dollars=(s:string)=>"$"+Number(s).toFixed(2);
export default async function AgentsPage(){
 const data=await controlPlaneOverview();
 const blocks=data.events.filter(e=>e.outcome==="block").length;
 const allowed=data.events.filter(e=>e.outcome==="allow").length;
 const costs=data.agents.reduce((sum,a)=>sum+Number(a.spent_usd),0);
 return <>
 <div className="page-head">
  <p className="download-eyebrow">AI agent governance / shared runtime</p>
  <div className="endpoint-headrow"><div><h1>Agent Control Plane</h1>
   <p className="muted">One place to register Claude, Codex, Cursor and custom agent runtimes, enforce controls, coordinate tasks and manage model spending.</p></div>
   <Link className="btn" href="/app/devices">Endpoint security</Link></div>
 </div>
 {data.demo&&<section className="warning"><h2>Demonstration mode</h2><p>The control plane requires the PostgreSQL-backed console. Mutating controls, registration and runtime API calls are disabled without DATABASE_URL. The sections below are empty, not live data.</p></section>}
 <section className="tiles">
  <div className="tile"><b>{data.agents.length}</b><span>Registered agents</span></div>
  <div className="tile"><b>{data.controls.filter(x=>x.enabled).length}</b><span>Active shared controls</span></div>
  <div className="tile high"><b>{blocks}</b><span>Blocks in last {data.events.length} events</span></div>
  <div className="tile"><b>{allowed}</b><span>Allows in last {data.events.length} events</span></div>
  <div className="tile"><b>{dollars(String(costs))}</b><span>Reported lifetime spending</span></div>
  <div className="tile"><b>{data.tasks.filter(x=>x.status!=="done").length}</b><span>Open collaboration tasks</span></div>
 </section>
 {!data.demo&&<AgentControlForms agents={data.agents.map(a=>({id:a.id,name:a.name,limit:a.limit_usd,preferred:a.preferred_model,allowed:a.allowed_models}))} clients={data.clients}/>}
 <section className="panel" id="agents">
  <div className="panel-head"><h2>Registered agent runtimes</h2><span className="muted small">Auto-registration requires a scoped 24-hour enrollment token</span></div>
  <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Framework</th><th>Client scope</th><th>Status</th><th>Model policy</th><th>Spent / cap</th><th>Last check-in</th></tr></thead><tbody>
   {data.agents.map(a=><tr key={a.id}><td><b>{a.name}</b></td><td>{a.framework}</td><td>{a.client_name||"MSP-wide"}</td><td><span className={"endpoint-status "+(a.status==="online"?"healthy":"attention")}>{a.status}</span></td>
   <td className="small">{a.preferred_model||"Runtime choice"}<div className="muted small">{a.allowed_models.length?a.allowed_models.join(", "):"Any model permitted"}</div></td>
   <td>{dollars(a.spent_usd)} / {dollars(a.limit_usd)}<div className="muted small">{dollars(a.reserved_usd)} reserved</div></td>
   <td className="muted small">{new Date(a.last_seen).toLocaleString()}</td></tr>)}
  </tbody></table></div>
  {!data.agents.length&&<p className="empty">No registered runtime agents yet. Generate an enrollment token above, install the SDK, and start an agent process.</p>}
 </section>
 <section className="panel" id="policies"><div className="panel-head"><h2>Runtime safety controls</h2><span className="muted small">Global controls apply to all registered agents in the MSP tenant</span></div>
  <div className="table-wrap"><table><thead><tr><th>Control</th><th>Evaluator</th><th>Phase</th><th>Decision</th><th>Applies to</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {data.controls.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{c.evaluator}</td><td>{c.phase}</td><td>{c.effect}</td><td>{c.agent_name||"All agents"}</td>
      <td><span className={"endpoint-status "+(c.enabled?"healthy":"stale")}>{c.enabled?"Enabled":"Disabled"}</span></td>
      <td><form action={controlToggleAction.bind(null,c.id)}><input type="hidden" name="enabled" value={c.enabled?"false":"true"}/><button className="btn small">{c.enabled?"Disable":"Enable"}</button></form></td></tr>)}
   </tbody></table></div>{!data.controls.length&&<p className="empty">No active controls. Add a PII, injection, SQL, JSON, list, or safe regex rule.</p>}
 </section>
 <section className="panel" id="tasks"><div className="panel-head"><h2>Agent collaboration channel</h2><span className="muted small">Agent claim / handoff / result messages</span></div>
  <div className="table-wrap"><table><thead><tr><th>Task</th><th>Scope</th><th>Claimed by</th><th>Status</th><th>Budget</th><th>Model</th></tr></thead>
  <tbody>{data.tasks.map(t=><tr key={t.id}><td><b>{t.title}</b><div className="muted small">{t.description.slice(0,125)}</div><div className="muted small">Task ID: <code>{t.id}</code></div></td>
  <td>{t.client_name||"MSP coordinator"}</td><td>{t.agent_name||"Unassigned"}</td><td><span className="endpoint-status">{t.status}</span></td>
  <td>{dollars(t.spent_usd)} / {dollars(t.budget_usd)}<div className="muted small">{dollars(t.reserved_usd)} held</div></td><td>{t.preferred_model||"Agent policy"}</td></tr>)}</tbody></table></div>
  {!data.tasks.length&&<p className="empty">No tasks yet. Create a task and let a connected agent claim it via the SDK.</p>}
 </section>
 <section className="panel" id="messages"><div className="panel-head"><h2>Shared agent messages</h2><span className="muted small">Messages are explicitly posted by connected runtimes; private chat sessions are not automatically mirrored.</span></div>
  <div className="table-wrap"><table><thead><tr><th>Time</th><th>Agent</th><th>Type</th><th>Task</th><th>Message</th></tr></thead>
  <tbody>{data.messages.map(m=><tr key={m.id}><td className="small">{new Date(m.at).toLocaleString()}</td><td>{m.agent_name||m.sender}</td><td>{m.kind}</td><td><code>{m.task_id.slice(0,8)}</code></td><td className="small">{m.body}</td></tr>)}</tbody></table></div>
  {!data.messages.length&&<p className="empty">Shared updates will appear here when an agent posts progress, questions, handoffs or a result.</p>}
 </section>
 <section className="panel" id="events"><div className="panel-head"><h2>Runtime audit and decisions</h2><span className="muted small">Reasons only — raw prompts and model outputs are not stored in event rows</span></div>
  <div className="table-wrap"><table><thead><tr><th>Time</th><th>Agent</th><th>Phase</th><th>Decision</th><th>Rule</th><th>Reason</th><th>Cost</th></tr></thead>
  <tbody>{data.events.map(e=><tr key={e.id}><td className="small">{new Date(e.at).toLocaleString()}</td><td>{e.agent_name}</td><td>{e.phase}</td>
    <td><span className={"endpoint-status "+(e.outcome==="block"?"attention":e.outcome==="allow"?"healthy":"stale")}>{e.outcome}</span></td>
    <td>{e.rule||"—"}</td><td className="small">{e.reason}</td><td>{Number(e.cost_usd)>0?dollars(e.cost_usd):"—"}</td></tr>)}</tbody></table></div>
  {!data.events.length&&<p className="empty">No runtime decisions recorded yet. Install an SDK and wrap your first agent call.</p>}
 </section>
 <section className="panel"><div className="panel-head"><h2>Connect an agent</h2></div><div className="panel-body">
  <p>Create an enrollment token, then set <code>ZINLOOP_URL</code>, <code>ZINLOOP_ENROLLMENT_TOKEN</code>, and <code>ZINLOOP_AGENT_NAME</code> in your runtime's environment. The TypeScript SDK auto-registers on its first guarded call. Save the returned agent token to a secrets manager for future runs.</p>
  <p className="muted small">Framework wrappers require API-mediated calls; Zinloop cannot change ChatGPT, Claude or other consumer chat sessions without those products' supported integrations.</p>
  <p className="muted small">API routes: <code>/api/control-plane/register</code> and <code>/api/control-plane/runtime</code>. See <code>sdk/typescript/README.md</code> for examples.</p>
 </div></section>
 </>;
}