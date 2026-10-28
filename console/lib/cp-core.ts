import { randomBytes } from "node:crypto";
import { lookup, withTenant } from "./db.ts";
import { tokenHash } from "./secrets.ts";
import { evaluateControls, validateControl, type Control, type Evaluator, type Phase } from "./cp-rules.ts";

const mint=(prefix:string)=>prefix+"_"+randomBytes(32).toString("base64url");
const TOKEN=/^zla_[A-Za-z0-9_-]{43}$/;
const ENROLL=/^zle_[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short=(v:unknown,n=100)=>typeof v==="string"?v.trim().slice(0,n):"";
export class CpError extends Error {constructor(message:string,public status=400){super(message);}}
function bad(m:string,status=400):never {throw new CpError(m,status);}
function usd(v:unknown,max=1000):number{
  if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>max)return bad("Invalid USD amount");
  return Math.round(v*1e6)/1e6;
}
export async function registerAgent(enrollment:string,name:string,framework:string){
  if(!ENROLL.test(enrollment))return bad("Invalid enrollment credential",401);
  const owner=await lookup<{msp_id:string;client_id:string|null}>("select * from cp_lookup_enrollment($1)",[tokenHash(enrollment)]);
  if(!owner)return bad("Enrollment credential expired or revoked",401);
  const n=short(name,100),f=short(framework||"custom",80);
  if(!n)return bad("Agent name required");
  const key=mint("zla");
  const agent=await withTenant(owner.msp_id,async db=>{
    const r=await db.query<{id:string}>(
      "insert into cp_agents(msp_id,client_id,name,framework) values($1,$2,$3,$4) "+
      "on conflict (msp_id,name) do update set framework=excluded.framework,last_seen=now() "+
      "where cp_agents.status='online' and cp_agents.client_id is not distinct from excluded.client_id returning id",
      [owner.msp_id,owner.client_id,n,f]);
    if(!r.rows[0])return bad("Agent already registered in another client or disabled",403);
    const id=r.rows[0].id;
    await db.query("insert into cp_agent_tokens(msp_id,agent_id,token_hash) values($1,$2,$3)",[owner.msp_id,id,tokenHash(key)]);
    await db.query("insert into cp_budgets(msp_id,agent_id) values($1,$2) on conflict(agent_id) do nothing",[owner.msp_id,id]);
    return id;
  });
  return {agentId:agent,token:key};
}
export interface AgentPrincipal {mspId:string;agentId:string;clientId:string|null;name:string}
export async function authenticateAgent(key:string):Promise<AgentPrincipal>{
  if(!TOKEN.test(key))return bad("Invalid agent credential",401);
  const auth=await lookup<{msp_id:string;agent_id:string}>("select * from cp_lookup_agent($1)",[tokenHash(key)]);
  if(!auth)return bad("Agent credential revoked or unknown",401);
  return withTenant(auth.msp_id,async db=>{
    const r=(await db.query<{name:string;client_id:string|null}>("select name,client_id from cp_agents where id=$1 and status='online'",[auth.agent_id])).rows[0];
    if(!r)return bad("Agent disabled",401);
    return {mspId:auth.msp_id,agentId:auth.agent_id,clientId:r.client_id,name:r.name};
  });
}
export async function evaluate(p:AgentPrincipal,phase:Phase,content:string){
  if(!["input","output","tool"].includes(phase))return bad("Unknown guardrail phase");
  const rules=await withTenant(p.mspId,async db=>(await db.query<Control>(
    "select id,name,phase,evaluator,effect,config from cp_controls "+
    "where enabled and (agent_id is null or agent_id=$1) and (phase='all' or phase=$2) "+
    "order by created_at limit 100",[p.agentId,phase])).rows);
  const result=evaluateControls(rules,phase,content);
  await withTenant(p.mspId,async db=>{
    if(result.matches.length)for(const m of result.matches){
      await db.query("insert into cp_events(msp_id,agent_id,control_id,phase,outcome,rule,reason) values($1,$2,$3,$4,$5,$6,$7)",[p.mspId,p.agentId,m.controlId,phase,m.effect,m.rule,m.reason]);
    } else await db.query("insert into cp_events(msp_id,agent_id,phase,outcome,rule,reason) values($1,$2,$3,'allow','','No matching controls')",[p.mspId,p.agentId,phase]);
    await db.query("update cp_agents set last_seen=now() where id=$1",[p.agentId]);
  });
  return result;
}
export async function reserve(p:AgentPrincipal,args:{taskId?:string;requestedModel?:string;maxUsd?:number}){
  const amount=usd(args.maxUsd,100);
  if(amount<=0)return bad("Positive maxUsd reservation required");
  const taskId=args.taskId||null;
  if(taskId&&!UUID.test(taskId))return bad("Invalid task ID");
  return withTenant(p.mspId,async db=>{
    const budget=(await db.query<{limit_usd:string;spent_usd:string;reserved_usd:string;allowed_models:string[];preferred_model:string}>(
      "select limit_usd,spent_usd,reserved_usd,allowed_models,preferred_model from cp_budgets where agent_id=$1 for update",[p.agentId])).rows[0];
    if(!budget)return bad("Agent budget not found",403);
    let task:{preferred_model:string;budget_usd:string;spent_usd:string;reserved_usd:string}|undefined;
    if(taskId){
      task=(await db.query<{preferred_model:string;budget_usd:string;spent_usd:string;reserved_usd:string}>(
        "select preferred_model,budget_usd,spent_usd,reserved_usd from cp_tasks "+
        "where id=$1 and status='claimed' and assigned_agent_id=$2 and lease_until>now() "+
        "and ($3::uuid is null or client_id=$3::uuid) for update",
        [taskId,p.agentId,p.clientId])).rows[0];
      if(!task)return bad("Task not claimed by agent or lease expired",403);
      if(Number(task.spent_usd)+Number(task.reserved_usd)+amount>Number(task.budget_usd))return bad("Task budget exceeded",403);
    }
    if(task?.preferred_model && args.requestedModel && short(args.requestedModel,120)!==task.preferred_model)
      return bad("Task model is pinned; requested model differs",403);
    const model=task?.preferred_model||short(args.requestedModel,120)||budget.preferred_model;
    if(!model)return bad("No model selected; configure a preferred model or pass requestedModel");
    if(budget.allowed_models.length&&!budget.allowed_models.includes(model))return bad("Model not allowed for this agent",403);
    if(Number(budget.spent_usd)+Number(budget.reserved_usd)+amount>Number(budget.limit_usd))return bad("Agent budget exceeded",403);
    await db.query("update cp_budgets set reserved_usd=reserved_usd+$2,updated_at=now() where agent_id=$1",[p.agentId,amount]);
    if(taskId)await db.query("update cp_tasks set reserved_usd=reserved_usd+$2 where id=$1",[taskId,amount]);
    const row=(await db.query<{id:string}>("insert into cp_reservations(msp_id,agent_id,task_id,amount_usd) values($1,$2,$3,$4) returning id",[p.mspId,p.agentId,taskId,amount])).rows[0];
    return {reservationId:row.id,model,maxUsd:amount};
  });
}
export async function settle(p:AgentPrincipal,id:string,actualUsd:unknown,status:"completed"|"cancelled"){
  if(!UUID.test(id))return bad("Invalid reservation ID");
  if(status!=="completed"&&status!=="cancelled")return bad("Invalid completion status");
  const cost=status==="cancelled"?0:usd(actualUsd,10000);
  return withTenant(p.mspId,async db=>{
    const r=(await db.query<{task_id:string|null;amount_usd:string;status:string;actual_usd:string|null}>(
      "select task_id,amount_usd,status,actual_usd from cp_reservations where id=$1 and agent_id=$2 for update",[id,p.agentId])).rows[0];
    if(!r)return bad("Unknown reservation",404);
    if(r.status!=="active")return {status:r.status,costUsd:Number(r.actual_usd||0),alreadySettled:true};
    await db.query("update cp_reservations set status=$2,actual_usd=$3 where id=$1",[id,status,cost]);
    await db.query("update cp_budgets set reserved_usd=greatest(0,reserved_usd-$2),spent_usd=spent_usd+$3,updated_at=now() where agent_id=$1",[p.agentId,r.amount_usd,cost]);
    if(r.task_id)await db.query("update cp_tasks set reserved_usd=greatest(0,reserved_usd-$2),spent_usd=spent_usd+$3 where id=$1",[r.task_id,r.amount_usd,cost]);
    await db.query("insert into cp_events(msp_id,agent_id,phase,outcome,rule,reason,task_id,cost_usd) values($1,$2,'budget',$3,'settlement',$4,$5,$6)",[
      p.mspId,p.agentId,cost>Number(r.amount_usd)?"warn":"allow",cost>Number(r.amount_usd)?"Actual cost exceeded reservation":"Reservation settled",r.task_id,cost]);
    return {status,costUsd:cost,overrun:cost>Number(r.amount_usd)};
  });
}
export async function claimTask(p:AgentPrincipal,taskId?:string){
  if(taskId&&!UUID.test(taskId))return bad("Invalid task ID");
  return withTenant(p.mspId,async db=>{
    const row=(await db.query<{id:string;title:string;description:string;budget_usd:string;preferred_model:string}>(
      "with next_task as (select id from cp_tasks "+
      "where (status='queued' or (status='claimed' and lease_until<now())) "+
      "and ($1::uuid is null or id=$1::uuid) and ($2::uuid is null or client_id=$2::uuid) "+
      "and (target_agent_id is null or target_agent_id=$3) "+
      "order by created_at for update skip locked limit 1) "+
      "update cp_tasks t set status='claimed',assigned_agent_id=$3,claimed_at=now(),lease_until=now()+interval '15 minutes' "+
      "from next_task n where t.id=n.id returning t.id,t.title,t.description,t.budget_usd,t.preferred_model",
      [taskId||null,p.clientId,p.agentId])).rows[0];
    return row?{id:row.id,title:row.title,description:row.description,budgetUsd:Number(row.budget_usd),preferredModel:row.preferred_model}:null;
  });
}
export async function sendMessage(p:AgentPrincipal,args:{taskId:string;kind:string;body:string}){
  if(!UUID.test(args.taskId))return bad("Invalid task ID");
  const kind=args.kind||"progress";
  if(!["progress","handoff","result","question"].includes(kind))return bad("Unsupported message kind");
  const body=short(args.body,4000);
  if(!body)return bad("Message required");
  const safe=body.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{12,})\b/g,"[REDACTED_TOKEN]");
  return withTenant(p.mspId,async db=>{
    const t=(await db.query<{id:string}>("select id from cp_tasks where id=$1 and ($2::uuid is null or client_id=$2::uuid)",[args.taskId,p.clientId])).rows[0];
    if(!t)return bad("Task not accessible",403);
    const row=(await db.query<{id:string}>("insert into cp_messages(msp_id,task_id,agent_id,kind,body) values($1,$2,$3,$4,$5) returning id::text",[p.mspId,args.taskId,p.agentId,kind,safe])).rows[0];
    if(kind==="result")await db.query("update cp_tasks set status='done' where id=$1 and assigned_agent_id=$2",[args.taskId,p.agentId]);
    return {messageId:row.id};
  });
}
export async function pollChannel(p:AgentPrincipal,taskId:string,after=0){
  if(!UUID.test(taskId))return bad("Invalid task ID");
  const cursor=Number.isSafeInteger(after)&&after>=0?after:0;
  return withTenant(p.mspId,async db=>{
    const t=(await db.query<{id:string}>("select id from cp_tasks where id=$1 and ($2::uuid is null or client_id=$2::uuid)",[taskId,p.clientId])).rows[0];
    if(!t)return bad("Task not accessible",403);
    const rows=(await db.query<{id:string;agent_name:string|null;kind:string;body:string;at:Date}>(
      "select m.id::text,a.name as agent_name,m.kind,m.body,m.at from cp_messages m "+
      "left join cp_agents a on a.id=m.agent_id where m.task_id=$1 and m.id>$2 order by m.id limit 100",[taskId,cursor])).rows;
    return {messages:rows.map(r=>({...r,at:r.at.toISOString()}))};
  });
}

/** List active tasks and IDs so other eligible agents can join the channel. */
export async function listTasks(p:AgentPrincipal){
  return withTenant(p.mspId,async db=>{
    const rows=(await db.query<{id:string;title:string;status:string;assigned_agent_id:string|null;preferred_model:string;budget_usd:string}>(
      "select id,title,status,assigned_agent_id,preferred_model,budget_usd from cp_tasks "+
      "where ($1::uuid is null or client_id=$1::uuid) and (target_agent_id is null or target_agent_id=$2) order by created_at desc limit 100",
      [p.clientId,p.agentId])).rows;
    return {tasks:rows.map(r=>({id:r.id,title:r.title,status:r.status,claimedBy:r.assigned_agent_id,
      preferredModel:r.preferred_model,budgetUsd:Number(r.budget_usd)}))};
  });
}
/** Renew a task claim while actively working. */
export async function heartbeatTask(p:AgentPrincipal,taskId:string){
  if(!UUID.test(taskId))return bad("Invalid task ID");
  return withTenant(p.mspId,async db=>{
    const r=await db.query(
      "update cp_tasks set lease_until=now()+interval '15 minutes' "+
      "where id=$1 and assigned_agent_id=$2 and status='claimed' and lease_until>now() "+
      "and ($3::uuid is null or client_id=$3::uuid)",
      [taskId,p.agentId,p.clientId]);
    if(!r.rowCount)return bad("Task not claimed by this agent or lease expired",403);
    return {ok:true,leaseMinutes:15};
  });
}
export async function finishTask(p:AgentPrincipal,taskId:string,result:"done"|"failed"){
  if(!UUID.test(taskId)||!["done","failed"].includes(result))return bad("Invalid task status");
  return withTenant(p.mspId,async db=>{
    const r=await db.query(
      "update cp_tasks set status=$3,lease_until=null where id=$1 and assigned_agent_id=$2 "+
      "and status='claimed' and ($4::uuid is null or client_id=$4::uuid)",
      [taskId,p.agentId,result,p.clientId]);
    if(!r.rowCount)return bad("Only the claiming agent can complete this task",403);
    return {ok:true,status:result};
  });
}

export function createControlConfig(evaluator:Evaluator,raw:string){
  let config:Record<string,unknown>;
  try{
    const v:unknown=JSON.parse(raw||"{}");
    if(!v||Array.isArray(v)||typeof v!=="object")return bad("Control JSON must be an object");
    config=v as Record<string,unknown>;
  }catch{return bad("Invalid JSON configuration");}
  validateControl(evaluator,config);return config;
}