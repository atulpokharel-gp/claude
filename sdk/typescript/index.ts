/**
 * Zinloop Agent Control Plane SDK — zero runtime dependencies.
 * Runs on Node.js 20+ and modern JavaScript runtimes with fetch.
 * Guarded text is sent to your configured Zinloop server for policy evaluation.
 * Only sanitized decision reasons are stored by the server, not raw prompts.
 */
export interface TelemetryEvent {type:string;agent:string;taskId?:string;decision?:string;elapsedMs?:number;model?:string;costUsd?:number}
export interface ClientOptions {
  url:string;name:string;framework?:string;agentToken?:string;enrollmentToken?:string;
  onTelemetry?:(event:TelemetryEvent)=>void;
}
export interface GuardDecision {decision:"allow"|"warn"|"block";matches:{controlId:string;rule:string;effect:string;reason:string}[]}
export interface Reservation {reservationId:string;model:string;maxUsd:number}
export interface CallResult<T> {value:T;outputText:string;costUsd:number}
export interface RunOptions {input:string;maxUsd:number;taskId?:string;requestedModel?:string;phase?:"input"|"tool"}
export type Evaluator=(phase:"input"|"output"|"tool",text:string)=>boolean|Promise<boolean>;
export class ZinloopBlocked extends Error {
  constructor(public readonly decision:GuardDecision){super("Zinloop policy blocked this call");}
}
export class ZinloopAgent {
  private token:string|undefined;
  private setupPromise:Promise<string>|undefined;
  private localEvaluators=new Map<string,Evaluator>();
  constructor(private readonly options:ClientOptions){
    if(!/^https:\/\//.test(options.url)&&!/^http:\/\/localhost(?::\d+)?$/.test(options.url))
      throw Error("Control plane requires HTTPS (localhost HTTP allowed for development)");
    this.token=options.agentToken;
  }
  /** Register an additional local evaluator. Server-side controls still apply. */
  addEvaluator(name:string,fn:Evaluator){this.localEvaluators.set(name,fn);}
  private telemetry(data:Omit<TelemetryEvent,"agent">){
    try{this.options.onTelemetry?.({...data,agent:this.options.name});}catch{/* never affect protected call */}
  }
  private async request<T>(path:string,body:Record<string,unknown>,token?:string):Promise<T>{
    const response=await fetch(this.options.url.replace(/\/$/,"")+path,{
      method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });
    const result=await response.json() as T & {error?:string};
    if(!response.ok)throw Error("Zinloop control plane: "+(result.error||"HTTP "+response.status));
    return result;
  }
  async register():Promise<string>{
    if(this.token)return this.token;
    if(!this.options.enrollmentToken)throw Error("Missing ZINLOOP_AGENT_TOKEN or ZINLOOP_ENROLLMENT_TOKEN");
    if(!this.setupPromise){
      this.setupPromise=this.request<{agentId:string;token:string}>("/api/control-plane/register",{
        enrollmentToken:this.options.enrollmentToken,name:this.options.name,framework:this.options.framework||"custom"
      }).then(r=>{
        this.token=r.token;
        // Save this token in your own secrets manager for subsequent processes.
        this.telemetry({type:"agent_registered"});
        return r.token;
      }).catch(err=>{this.setupPromise=undefined;throw err;});
    }
    return this.setupPromise;
  }
  private async runtime<T>(payload:Record<string,unknown>):Promise<T>{
    const token=await this.register();
    return this.request<T>("/api/control-plane/runtime",payload,token);
  }
  async evaluate(phase:"input"|"output"|"tool",content:string):Promise<GuardDecision>{
    for(const [name,test] of this.localEvaluators)if(await test(phase,content)){
      const decision:GuardDecision={decision:"block",matches:[{controlId:"local",rule:name,effect:"block",reason:"Local evaluator rejected input"}]};
      this.telemetry({type:"policy_decision",decision:"block"});
      return decision;
    }
    const res=await this.runtime<GuardDecision>({action:"evaluate",phase,content});
    this.telemetry({type:"policy_decision",decision:res.decision});
    return res;
  }
  async reserve(maxUsd:number,requestedModel?:string,taskId?:string):Promise<Reservation>{
    return this.runtime<Reservation>({action:"reserve",maxUsd,requestedModel,taskId});
  }
  async settle(reservationId:string,actualUsd:number,status:"completed"|"cancelled"="completed"){
    return this.runtime<{status:string;costUsd:number;overrun?:boolean}>({action:"settle",reservationId,actualUsd,status});
  }
  async claim(taskId?:string){
    return this.runtime<{task:{id:string;title:string;description:string;budgetUsd:number;preferredModel:string}|null}>({action:"claim",taskId});
  }
  async tasks(){
    return this.runtime<{tasks:{id:string;title:string;status:string;claimedBy:string|null;preferredModel:string;budgetUsd:number}[]}>({action:"tasks"});
  }
  async heartbeat(taskId:string){
    return this.runtime<{ok:boolean;leaseMinutes:number}>({action:"heartbeat",taskId});
  }
  async finish(taskId:string,status:"done"|"failed"="done"){
    return this.runtime<{ok:boolean;status:string}>({action:"finish",taskId,status});
  }
  async message(taskId:string,body:string,kind:"progress"|"handoff"|"result"|"question"="progress"){
    return this.runtime<{messageId:string}>({action:"message",taskId,body,kind});
  }
  async poll(taskId:string,after=0){
    return this.runtime<{messages:{id:string;agent_name:string|null;kind:string;body:string;at:string}[]}>({action:"poll",taskId,after});
  }
  /** Preferred API: use the model selected by the server to call your provider. */
  async run<T>(opts:RunOptions,invoke:(model:string)=>Promise<CallResult<T>>):Promise<T>{
    const start=Date.now();
    const initial=await this.evaluate(opts.phase||"input",opts.input);
    if(initial.decision==="block")throw new ZinloopBlocked(initial);
    const r=await this.reserve(opts.maxUsd,opts.requestedModel,opts.taskId);
    let cost=0;
    let state:"completed"|"cancelled"="cancelled";
    try{
      const result=await invoke(r.model);
      cost=result.costUsd;
      if(!Number.isFinite(cost)||cost<0)throw Error("Model provider must report a finite, non-negative costUsd");
      state="completed";
      const after=await this.evaluate("output",result.outputText);
      if(after.decision==="block")throw new ZinloopBlocked(after);
      this.telemetry({type:"model_call",elapsedMs:Date.now()-start,costUsd:cost,model:r.model,taskId:opts.taskId,decision:after.decision});
      return result.value;
    }finally{
      // Record cost even when the output guard blocks. If invoke threw after
      // provider billing, its unknown cost requires external reconciliation.
      await this.settle(r.reservationId,cost,state);
    }
  }
  /** Decorator-style wrapper for a model/tool call with a fixed allowed model.
   * Does not change the original function signature.
   */
  guard<Args extends unknown[],T>(
    fn:(...args:Args)=>Promise<CallResult<T>>,
    options:{input:(...args:Args)=>string;maxUsd:number;model:string;taskId?:string;phase?:"input"|"tool"}
  ):(...args:Args)=>Promise<T>{
    return (...args:Args)=>this.run({
      input:options.input(...args),maxUsd:options.maxUsd,requestedModel:options.model,
      taskId:options.taskId,phase:options.phase
    },async model=>{
      if(model!==options.model)throw Error("Server-selected model differs from fixed guarded model");
      return fn(...args);
    });
  }
}
