"use client";
import { useActionState } from "react";
import {enrollmentAction,controlAction,taskAction,budgetAction,type FormResult} from "@/app/(console)/app/agents/actions.ts";

function Result({state}:{state:FormResult}){
 return <>{state.error&&<p role="alert" className="form-error">{state.error}</p>}{state.success&&<p role="status" className="muted small">{state.success}</p>}
 {state.secret&&<div className="token-once"><b>Copy this enrollment token now — it will not appear again.</b><pre>{state.secret}</pre><p className="small">Store in an environment secret, not in source control.</p></div>}</>;
}
export function AgentControlForms({agents,clients}:{agents:{id:string;name:string;limit:string;preferred:string;allowed:string[]}[];clients:{id:string;name:string}[]}){
 const [enrollState,enroll,pendingEnrollment]=useActionState(enrollmentAction,{});
 const [controlState,control,pendingControl]=useActionState(controlAction,{});
 const [taskState,task,pendingTask]=useActionState(taskAction,{});
 const [budgetState,budget,pendingBudget]=useActionState(budgetAction,{});
 return <div className="cp-form-grid">
  <section className="panel"><div className="panel-head"><h2>1. Agent enrollment</h2></div><form className="cp-form" action={enroll}>
   <p className="muted small">Create a 24-hour enrollment token. Your running agent registers itself on first launch.</p>
   <label>Enrollment label<input name="label" maxLength={120} placeholder="Claude Code / production"/></label>
   <label>Scope<select name="client"><option value="">MSP-wide (trusted coordinator)</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <button className="btn primary" type="submit" disabled={pendingEnrollment}>Create enrollment token</button><Result state={enrollState}/>
  </form></section>
  <section className="panel"><div className="panel-head"><h2>2. Shared guardrail</h2></div><form className="cp-form" action={control}>
   <label>Rule name<input name="name" required maxLength={120} placeholder="Block possible PII in outputs"/></label>
   <div className="cp-form-row"><label>Evaluator<select name="evaluator"><option value="pii">PII pattern</option><option value="prompt_injection">Prompt injection</option><option value="regex">Safe regex</option><option value="list">Blocked terms</option><option value="json">JSON keys</option><option value="sql">SQL risk</option></select></label>
   <label>Phase<select name="phase"><option value="all">All phases</option><option value="input">Input</option><option value="output">Output</option><option value="tool">Tool</option></select></label></div>
   <div className="cp-form-row"><label>Decision<select name="effect"><option value="block">Block</option><option value="warn">Warn</option></select></label>
   <label>Applies to<select name="agent"><option value="">All agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
   <label>Evaluator JSON configuration<textarea name="config" defaultValue="{}" rows={2} spellCheck={false}/></label>
   <p className="muted small">Examples: list: {"{\"terms\":[\"secret-project\"]}"} · JSON: {"{\"blockedKeys\":[\"password\"]}"} · regex: {"{\"pattern\":\"confidential\"}"}</p>
   <button className="btn primary" disabled={pendingControl}>Create control</button><Result state={controlState}/>
  </form></section>
  <section className="panel"><div className="panel-head"><h2>3. Shared collaboration task</h2></div><form className="cp-form" action={task}>
   <label>Task name<input name="title" required placeholder="Review MCP rollout risks" maxLength={200}/></label>
   <label>Instructions (shared with eligible agent runtimes)<textarea name="description" rows={2} maxLength={2000}/></label>
   <div className="cp-form-row"><label>Client scope<select name="client"><option value="">MSP coordinator only</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Task budget (USD)<input name="budget" type="number" min="0.01" max="1000" step="0.01" defaultValue="1.00" required/></label></div>
   <label>Target agent (optional)<select name="targetAgent"><option value="">Any eligible agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label>Preferred model (pinned for this task, optional)<input name="model" placeholder="Use an exact provider model ID" maxLength={120}/></label>
   <button className="btn primary" disabled={pendingTask}>Create shared task</button><Result state={taskState}/>
  </form></section>
  <section className="panel"><div className="panel-head"><h2>4. Per-agent model and spend policy</h2></div><form className="cp-form" action={budget}>
   <label>Agent<select name="agent" required><option value="">Choose registered agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <div className="cp-form-row"><label>Lifetime cap (USD)<input name="limit" type="number" min="0" step="0.01" defaultValue="5" required/></label>
   <label>Preferred model<input name="model" placeholder="Exact provider model ID" maxLength={120}/></label></div>
   <label>Allowed model IDs (comma separated)<input name="allowed" placeholder="Empty means any model — set an allowlist for enforcement"/></label>
   <p className="muted small">Limits apply to SDK reservations. Use actual token/cost accounting from the model provider and set provider-side caps too.</p>
   <button className="btn primary" disabled={pendingBudget||!agents.length}>Save budget policy</button><Result state={budgetState}/>
  </form></section>
 </div>;
}