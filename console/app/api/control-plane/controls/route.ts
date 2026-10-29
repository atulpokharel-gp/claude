// MSP management API: cookie-authenticated, same-origin only for writes.
// Agents cannot edit their own controls. Programmatic provisioning from other
// hosts needs a future scoped admin key, not reuse of agent runtime tokens.
import { currentSession } from "@/lib/session.ts";
import { hasDatabase, withTenant } from "@/lib/db.ts";
import { validateControl, type Evaluator } from "@/lib/cp-rules.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(code:number,data:object)=>Response.json(data,{status:code,headers:{"Cache-Control":"no-store"}});
export async function GET(){
  if(!hasDatabase())return json(503,{error:"Database unavailable"});
  const s=await currentSession();
  if(!s)return json(401,{error:"Login required"});
  if(s.requireMfa&&!s.mfa)return json(403,{error:"Two-factor authentication required"});
  const rows=await withTenant(s.mspId,async db=>(await db.query(
    "select id,name,agent_id,phase,evaluator,effect,config,enabled,created_at from cp_controls order by created_at desc limit 200"
  )).rows);
  return json(200,{controls:rows});
}
export async function POST(req:Request){
  if(!hasDatabase())return json(503,{error:"Database unavailable"});
  const s=await currentSession();
  if(!s)return json(401,{error:"Login required"});
  if(s.requireMfa&&!s.mfa)return json(403,{error:"Two-factor authentication required"});
  if(!["owner","member"].includes(s.role))return json(403,{error:"Insufficient role"});
  const origin=req.headers.get("origin");
  const expected=new URL(req.url).origin;
  if(!origin||origin!==expected)return json(403,{error:"Same-origin request required"});
  if(Number(req.headers.get("content-length")||0)>6000)return json(413,{error:"Request too large"});
  try{
    const raw=await req.text();
    if(raw.length>6000)return json(413,{error:"Request too large"});
    const value:unknown=JSON.parse(raw);
    if(!value||Array.isArray(value)||typeof value!=="object")return json(400,{error:"Expected object"});
    const x=value as Record<string,unknown>;
    const name=typeof x.name==="string"?x.name.trim():"";
    const phase=x.phase, effect=x.effect, evaluator=x.evaluator as Evaluator;
    const agentId=typeof x.agentId==="string"?x.agentId:null;
    const config=x.config&&typeof x.config==="object"&&!Array.isArray(x.config)?x.config as Record<string,unknown>:{};
    if(!name||name.length>120)return json(400,{error:"Invalid name"});
    if(!["input","output","tool","all"].includes(String(phase)))return json(400,{error:"Invalid phase"});
    if(!["block","warn"].includes(String(effect)))return json(400,{error:"Invalid effect"});
    validateControl(evaluator,config);
    const id=await withTenant(s.mspId,async db=>{
      if(agentId){
        if(!/^[0-9a-f-]{36}$/i.test(agentId))throw Error("Invalid agent");
        const exists=await db.query("select 1 from cp_agents where id=$1",[agentId]);
        if(!exists.rowCount)throw Error("Unknown agent");
      }
      const result=await db.query<{id:string}>(
        "insert into cp_controls(msp_id,agent_id,name,phase,evaluator,effect,config) values($1,$2,$3,$4,$5,$6,$7) returning id",
        [s.mspId,agentId,name,phase,evaluator,effect,JSON.stringify(config)]);
      return result.rows[0].id;
    });
    return json(201,{id});
  }catch(e){return json(400,{error:e instanceof Error?e.message:"Invalid request"});}
}