import { hasDatabase, withTenant } from "./db.ts";
import { requireSession } from "./session.ts";
export interface CpAgentRow {id:string;name:string;framework:string;client_name:string|null;status:string;last_seen:Date;limit_usd:string;spent_usd:string;reserved_usd:string;preferred_model:string;allowed_models:string[]}
export interface CpControlRow {id:string;name:string;evaluator:string;phase:string;effect:string;enabled:boolean;agent_name:string|null;config:Record<string,unknown>}
export interface CpTaskRow {id:string;title:string;description:string;status:string;budget_usd:string;spent_usd:string;reserved_usd:string;preferred_model:string;agent_name:string|null;client_name:string|null;created_at:Date}
export interface CpEventRow {id:string;at:Date;agent_name:string;phase:string;outcome:string;rule:string;reason:string;cost_usd:string}
export interface CpMessageRow {id:string;at:Date;task_id:string;agent_name:string|null;sender:string;kind:string;body:string}
export interface CpClientRow {id:string;name:string}
export interface CpOverview{
 demo:boolean;agents:CpAgentRow[];controls:CpControlRow[];tasks:CpTaskRow[];
 events:CpEventRow[];messages:CpMessageRow[];clients:CpClientRow[];
}
export async function controlPlaneOverview():Promise<CpOverview>{
 if(!hasDatabase())return {demo:true,agents:[],controls:[],tasks:[],events:[],messages:[],clients:[]};
 const s=await requireSession();
 return withTenant(s.mspId,async db=>{
   const [agents,controls,tasks,events,messages,clients]=await Promise.all([
     db.query<CpAgentRow>("select a.id,a.name,a.framework,c.name as client_name,a.status,a.last_seen,b.limit_usd,b.spent_usd,b.reserved_usd,b.preferred_model,b.allowed_models from cp_agents a join cp_budgets b on b.agent_id=a.id left join clients c on c.id=a.client_id order by a.last_seen desc limit 200"),
     db.query<CpControlRow>("select p.id,p.name,p.evaluator,p.phase,p.effect,p.enabled,a.name as agent_name,p.config from cp_controls p left join cp_agents a on a.id=p.agent_id order by p.created_at desc limit 200"),
     db.query<CpTaskRow>("select t.id,t.title,t.description,t.status,t.budget_usd,t.spent_usd,t.reserved_usd,t.preferred_model,a.name as agent_name,c.name as client_name,t.created_at from cp_tasks t left join cp_agents a on a.id=t.assigned_agent_id left join clients c on c.id=t.client_id order by t.created_at desc limit 60"),
     db.query<CpEventRow>("select e.id::text,e.at,a.name as agent_name,e.phase,e.outcome,e.rule,e.reason,e.cost_usd from cp_events e join cp_agents a on a.id=e.agent_id order by e.at desc limit 100"),
     db.query<CpMessageRow>("select m.id::text,m.at,m.task_id,a.name as agent_name,m.sender,m.kind,m.body from cp_messages m left join cp_agents a on a.id=m.agent_id order by m.at desc limit 100"),
     db.query<CpClientRow>("select id,name from clients order by name")
   ]);
   return {demo:false,agents:agents.rows,controls:controls.rows,tasks:tasks.rows,events:events.rows,messages:messages.rows,clients:clients.rows};
 });
}