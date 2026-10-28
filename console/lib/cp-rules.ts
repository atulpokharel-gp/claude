// Deterministic V1 policy evaluators. Never executes agent input, SQL, JSONPath
// expressions or user-defined code. Evaluators can be extended via new
// registered server-side adapters after code review.
export type Phase = "input" | "output" | "tool";
export type Evaluator = "pii" | "prompt_injection" | "regex" | "list" | "json" | "sql";
export interface Control {
  id: string; name: string; phase: Phase | "all"; evaluator: Evaluator;
  effect: "block" | "warn"; config: Record<string,unknown>;
}
export interface Match { controlId:string; rule:string; effect:"block"|"warn"; reason:string }
const safe=(s:string)=>s.slice(0,8192);
const textValue=(v:unknown)=>typeof v==="string"?v:"";
const stringList=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==="string").slice(0,150):[];
/** Reject potential catastrophic backtracking and advanced features in tenant regex. */
export function validateControl(evaluator: Evaluator, config:Record<string,unknown>) {
  if (!["pii","prompt_injection","regex","list","json","sql"].includes(evaluator)) throw Error("Unsupported evaluator");
  if (JSON.stringify(config).length>4000) throw Error("Control configuration is too large");
  if(evaluator==="regex"){
    const pattern=textValue(config.pattern);
    if(!pattern||pattern.length>160 || /[()[\]{}\\]/.test(pattern) || /\*\*|\+\+|\*\+|\+\*/.test(pattern))
      throw Error("Regex v1 supports simple patterns only (no groups, escapes, character classes or repetition nesting).");
    try {new RegExp(pattern,"i");}catch{throw Error("Invalid regex");}
  }
  if(evaluator==="list" && (!stringList(config.terms).length || stringList(config.terms).some(x=>x.length>100))) throw Error("List needs 1–150 terms, each <=100 characters.");
  if(evaluator==="json" && stringList(config.requiredKeys).length===0 && stringList(config.blockedKeys).length===0) throw Error("JSON rules require requiredKeys or blockedKeys.");
}
function check(e:Evaluator, config:Record<string,unknown>, content:string):string|null {
  const txt=safe(content), lower=txt.toLowerCase();
  switch(e){
    case "pii": {
      // Heuristics, not a DLP guarantee.
      if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(txt)) return "Possible email address";
      if(/\b\d{3}-\d{2}-\d{4}\b/.test(txt)) return "Possible US SSN pattern";
      return null;
    }
    case "prompt_injection": {
      if(/ignore (all |your |the )?(previous|prior|system) instructions/i.test(txt))return "Instruction override attempt";
      if(/reveal (your |the )?(system prompt|hidden instructions)/i.test(txt))return "Hidden-instruction disclosure attempt";
      if(/(?:^|\n)\s*(?:system|developer)\s*:/i.test(txt))return "Untrusted role header";
      return null;
    }
    case "regex": {
      validateControl(e,config);
      return new RegExp(textValue(config.pattern),"i").test(txt)?"Configured text pattern matched":null;
    }
    case "list":{
      const terms=stringList(config.terms).map(t=>t.toLowerCase()).filter(Boolean);
      return terms.some(t=>lower.includes(t))?"Configured blocked term matched":null;
    }
    case "json":{
      let obj:unknown;
      try {obj=JSON.parse(txt);}catch{return config.requireValid===true?"Invalid JSON":null;}
      if(!obj||Array.isArray(obj)||typeof obj!=="object")return config.requireValid===true?"Expected JSON object":null;
      const keys=Object.keys(obj as object);
      const required=stringList(config.requiredKeys);
      const denied=stringList(config.blockedKeys);
      if(required.some(k=>!keys.includes(k)))return "Required JSON key missing";
      if(denied.some(k=>keys.includes(k)))return "Blocked JSON key present";
      return null;
    }
    case "sql":{
      // SQL is parsed as plain text only, never executed.
      if(/\b(?:drop|truncate)\s+(?:table|database|schema)\b/i.test(txt))return "Destructive SQL statement";
      if(/\b(?:delete\s+from|update\s+[a-z_][\w.]*)\b/i.test(txt)&&!/\bwhere\b/i.test(txt))return "Potential unbounded SQL write";
      if(/\b(?:xp_cmdshell|pg_read_file|copy\s+.*\bprogram)\b/i.test(txt))return "Potential privileged SQL operation";
      return null;
    }
  }
}
export function evaluateControls(controls:Control[],phase:Phase,content:string) {
  if(typeof content!=="string"||content.length>16000) throw Error("Content must be a string <=16000 characters");
  const matches:Match[]=[];
  for(const c of controls.slice(0,100)){
    if(c.phase!=="all"&&c.phase!==phase)continue;
    const reason=check(c.evaluator,c.config,content);
    if(reason)matches.push({controlId:c.id,rule:c.name,effect:c.effect,reason});
  }
  return {decision:matches.some(x=>x.effect==="block")?"block":matches.length?"warn":"allow" as "block"|"warn"|"allow",matches};
}
