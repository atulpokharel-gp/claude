"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withTenant, hasDatabase } from "@/lib/db.ts";
import { requireSession } from "@/lib/session.ts";
import { tokenHash } from "@/lib/secrets.ts";
import { CpError, createControlConfig } from "@/lib/cp-core.ts";
import type { Evaluator } from "@/lib/cp-rules.ts";

export type FormResult={error?:string;success?:string;secret?:string};
const text=(f:FormData,key:string,max=120)=>String(f.get(key)||"").trim().slice(0,max);
function isUUID(id:string){return /^[0-9a-f-]{36}$/i.test(id);}
async function admin(){
 if(!hasDatabase())throw new Error("Demo mode is read-only.");
 const s=await requireSession();
 if(s.role!=="owner"&&s.role!=="member")throw new Error("Owner/member role required.");
 return s;
}
const fail=(e:unknown):FormResult=>({error:e instanceof Error?e.message:"Could not save changes"});
export async function enrollmentAction(_prev:FormResult,fd:FormData):Promise<FormResult>{
 try{
  const s=await admin();
  const clientId=text(fd,"client",36)||null;
  const label=text(fd,"label",120)||"Agent SDK enrollment";
  const secret="zle_"+randomBytes(32).toString("base64url");
  await withTenant(s.mspId,async db=>{
    if(clientId&&!isUUID(clientId))throw Error("Invalid client");
    if(clientId) {
      const exists=await db.query("select 1 from clients where id=$1",[clientId]);
      if(!exists.rowCount)throw Error("Unknown client");
    }
    await db.query("insert into cp_enrollments(msp_id,client_id,label,token_hash,expires_at) values($1,$2,$3,$4,now()+interval '24 hours')",[
      s.mspId,clientId,label,tokenHash(secret)
    ]);
  });
  revalidatePath("/app/agents");
  return {success:"Enrollment key created. It is shown once and expires in 24 hours.",secret};
 }catch(e){return fail(e);}
}
export async function controlAction(_prev:FormResult,fd:FormData):Promise<FormResult>{
 try{
  const s=await admin();
  const name=text(fd,"name",120),phase=text(fd,"phase",12);
  const effect=text(fd,"effect",8),evaluator=text(fd,"evaluator",30) as Evaluator;
  const agentId=text(fd,"agent",36)||null;
  if(!name)throw Error("Control name required");
  if(!["input","output","tool","all"].includes(phase))throw Error("Invalid phase");
  if(!["block","warn"].includes(effect))throw Error("Invalid effect");
  const config=createControlConfig(evaluator,text(fd,"config",4000));
  await withTenant(s.mspId,async db=>{
    if(agentId){
      if(!isUUID(agentId))throw Error("Invalid agent");
      const r=await db.query("select 1 from cp_agents where id=$1",[agentId]);
      if(!r.rowCount)throw Error("Agent not found");
    }
    await db.query("insert into cp_controls(msp_id,agent_id,name,phase,evaluator,effect,config) values($1,$2,$3,$4,$5,$6,$7)",[
      s.mspId,agentId,name,phase,evaluator,effect,JSON.stringify(config)]);
  });
  revalidatePath("/app/agents");
  return {success:"Security control created. It applies to subsequent runtime evaluations."};
 }catch(e){return fail(e);}
}
export async function taskAction(_prev:FormResult,fd:FormData):Promise<FormResult>{
 try{
  const s=await admin();
  const title=text(fd,"title",200),description=text(fd,"description",2000);
  const client=text(fd,"client",36)||null;
  const target=text(fd,"targetAgent",36)||null;
  const model=text(fd,"model",120);
  const amount=Number(fd.get("budget"));
  if(!title)throw Error("Task title required");
  if(!Number.isFinite(amount)||amount<=0||amount>1000)throw Error("Task budget must be between $0.01 and $1000");
  if(client&&!isUUID(client))throw Error("Invalid client");
  if(target&&!isUUID(target))throw Error("Invalid target agent");
  await withTenant(s.mspId,async db=>{
    if(client){
      const valid=await db.query("select 1 from clients where id=$1",[client]);
      if(!valid.rowCount)throw Error("Client not found");
    }
    if(target){
      const a=(await db.query<{client_id:string|null}>("select client_id from cp_agents where id=$1 and status='online'",[target])).rows[0];
      if(!a||a.client_id!==client)throw Error("Target agent must match task client scope");
    }
    await db.query("insert into cp_tasks(msp_id,client_id,target_agent_id,title,description,budget_usd,preferred_model) values($1,$2,$3,$4,$5,$6,$7)",[
      s.mspId,client,target,title,description,amount,model]);
  });
  revalidatePath("/app/agents");
  return {success:"Task created in the shared channel. Eligible agents may claim it."};
 }catch(e){return fail(e);}
}
export async function budgetAction(_prev:FormResult,fd:FormData):Promise<FormResult>{
 try{
  const s=await admin(),id=text(fd,"agent",36),preferred=text(fd,"model",120);
  const limit=Number(fd.get("limit"));
  const allowed=text(fd,"allowed",1000).split(",").map(x=>x.trim()).filter(Boolean).slice(0,30);
  if(!isUUID(id)||!Number.isFinite(limit)||limit<0||limit>100000)throw Error("Invalid agent or budget");
  if(allowed.length && preferred && !allowed.includes(preferred))throw Error("Preferred model must be in the allowed models");
  await withTenant(s.mspId,async db=>{
    const r=await db.query("update cp_budgets set limit_usd=$2,preferred_model=$3,allowed_models=$4,updated_at=now() where agent_id=$1",[
      id,limit,preferred,allowed]);
    if(!r.rowCount)throw Error("Agent not found");
  });
  revalidatePath("/app/agents");
  return {success:"Model policy and spend limit updated. Existing reservations remain counted."};
 }catch(e){return fail(e);}
}
export async function controlToggleAction(id:string,fd:FormData):Promise<void>{
 const s=await admin();
 const enabled=String(fd.get("enabled"))==="true";
 if(!isUUID(id))throw Error("Invalid control");
 await withTenant(s.mspId,async db=>{
   await db.query("update cp_controls set enabled=$2 where id=$1",[id,enabled]);
 });
 revalidatePath("/app/agents");
}
