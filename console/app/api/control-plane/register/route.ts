import { hasDatabase } from "@/lib/db.ts";
import { CpError, registerAgent } from "@/lib/cp-core.ts";
export const runtime="nodejs";
function reply(code:number,data:object){return Response.json(data,{status:code,headers:{"Cache-Control":"no-store"}});}
export async function POST(req:Request){
  if(!hasDatabase())return reply(503,{error:"Agent registration is unavailable in demo mode."});
  if(Number(req.headers.get("content-length")||0)>4096)return reply(413,{error:"Request too large"});
  try{
    const raw=await req.text();
    if(raw.length>4096)return reply(413,{error:"Request too large"});
    const v:unknown=JSON.parse(raw);
    if(!v||typeof v!=="object"||Array.isArray(v))return reply(400,{error:"Expected JSON object"});
    const r=v as Record<string,unknown>;
    const result=await registerAgent(typeof r.enrollmentToken==="string"?r.enrollmentToken:"",
      typeof r.name==="string"?r.name:"",typeof r.framework==="string"?r.framework:"custom");
    return reply(201,result);
  }catch(e){if(e instanceof CpError)return reply(e.status,{error:e.message});
    return reply(400,{error:"Invalid registration request"});}
}