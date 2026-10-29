import { hasDatabase } from "@/lib/db.ts";
import { authenticateAgent, evaluate, reserve, settle, claimTask, sendMessage, pollChannel, listTasks, heartbeatTask, finishTask, CpError } from "@/lib/cp-core.ts";
import type { Phase } from "@/lib/cp-rules.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const respond=(code:number,data:object)=>Response.json(data,{status:code,headers:{"Cache-Control":"no-store"}});
export async function POST(req:Request){
  if(!hasDatabase())return respond(503,{error:"Control plane is unavailable in demo mode"});
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return respond(401,{error:"Bearer agent token required"});
  if(Number(req.headers.get("content-length")||0)>22000)return respond(413,{error:"Request too large"});
  try{
    const principal=await authenticateAgent(authorization.slice(7).trim());
    const raw=await req.text();
    if(raw.length>22000)return respond(413,{error:"Request too large"});
    const v:unknown=JSON.parse(raw);
    if(!v||typeof v!=="object"||Array.isArray(v))return respond(400,{error:"JSON object required"});
    const x=v as Record<string,unknown>;
    const action=x.action;
    if(action==="evaluate"){
      const result=await evaluate(principal,x.phase as Phase,String(x.content??""));
      return respond(200,result);
    }
    if(action==="reserve")return respond(200,await reserve(principal,{
      taskId:typeof x.taskId==="string"?x.taskId:undefined,
      requestedModel:typeof x.requestedModel==="string"?x.requestedModel:undefined,
      maxUsd:typeof x.maxUsd==="number"?x.maxUsd:undefined
    }));
    if(action==="settle")return respond(200,await settle(principal,String(x.reservationId||""),x.actualUsd,
      x.status==="cancelled"?"cancelled":"completed"));
    if(action==="claim")return respond(200,{task:await claimTask(principal,typeof x.taskId==="string"?x.taskId:undefined)});
    if(action==="tasks")return respond(200,await listTasks(principal));
    if(action==="heartbeat")return respond(200,await heartbeatTask(principal,String(x.taskId||"")));
    if(action==="finish")return respond(200,await finishTask(principal,String(x.taskId||""),x.status==="failed"?"failed":"done"));
    if(action==="message")return respond(200,await sendMessage(principal,{
      taskId:String(x.taskId||""),kind:String(x.kind||"progress"),body:String(x.body||"")
    }));
    if(action==="poll")return respond(200,await pollChannel(principal,String(x.taskId||""),Number(x.after||0)));
    return respond(400,{error:"Unknown runtime action"});
  }catch(e){
    if(e instanceof CpError)return respond(e.status,{error:e.message});
    if(e instanceof SyntaxError)return respond(400,{error:"Invalid JSON"});
    console.error("control-plane runtime request failed");
    return respond(500,{error:"Control plane request failed"});
  }
}