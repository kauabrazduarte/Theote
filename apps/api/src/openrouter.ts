import { db } from './database';
import { broadcast } from './realtime';

const BASE='https://openrouter.ai/api/v1';
const DECISION_MODEL='respan/span-01-lite';
const CHAT_MODEL='inclusionai/ling-3.1-flash';
const DECISION_FALLBACK_MODEL='openai/gpt-4.1-nano';
const CHAT_FALLBACK_MODEL='mistralai/mistral-nemo';
const RETRYABLE_STATUS=new Set([429,500,502,503,504]);
type Usage={prompt_tokens?:number;completion_tokens?:number;total_tokens?:number;cost?:number;cost_details?:{upstream_inference_cost?:number}};
type ModelPrice={prompt:number;completion:number};
export type ChatMessage={role:'system'|'user'|'assistant';content:string};
export type ToolDefinition={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};

const key=process.env.OPENROUTER_API_KEY??'';
const configuredBudget=Number(process.env.WORLD_MONTHLY_BUDGET_USD??'0');
export const aiEnabled=process.env.WORLD_AI_ENABLED==='true'&&Boolean(key)&&Number.isFinite(configuredBudget)&&configuredBudget>0;
export const monthlyBudget=Number.isFinite(configuredBudget)&&configuredBudget>0?configuredBudget:0;
export const configuredInterval={min:Math.max(3_000,Math.min(5_000,Number(process.env.WORLD_DECISION_INTERVAL_MIN_MS)||3_000)),max:Math.max(3_000,Math.min(5_000,Number(process.env.WORLD_DECISION_INTERVAL_MAX_MS)||5_000))};
let prices:Map<string,ModelPrice>|null=null;
let pricesUpdatedAt=0;

async function openRouterFetch(url:string,init:RequestInit,retryQuota=true) {
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetch(url,init);
    if(!RETRYABLE_STATUS.has(response.status)||response.status===429&&!retryQuota||attempt===2)return response;
    const retryAfter=Number(response.headers.get('retry-after'));
    await response.body?.cancel();
    const delay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(4000,retryAfter*1000):800*2**attempt;
    await new Promise<void>((resolve,reject)=>{
      const onAbort=()=>{clearTimeout(timer);reject(init.signal?.reason??new Error('Chamada cancelada.'));};
      const timer=setTimeout(()=>{init.signal?.removeEventListener('abort',onAbort);resolve();},delay);
      if(init.signal?.aborted)onAbort();
      else init.signal?.addEventListener('abort',onAbort,{once:true});
    });
  }
  throw new Error('Não foi possível consultar o OpenRouter.');
}

function providerLimitError(error:unknown) {
  const message=error instanceof Error?error.message:'';
  return /^OpenRouter (?:402|429):/.test(message)||/^OpenRouter \d+:.*(?:credit|credits|quota|saldo|crédito|insufficient)/i.test(message);
}

async function modelPrices() {
  if(prices&&Date.now()-pricesUpdatedAt<30*60_000)return prices;
  if(!key)throw new Error('Configure a chave OpenRouter no ambiente local.');
  const response=await openRouterFetch(`${BASE}/models`,{headers:{Authorization:`Bearer ${key}`,'HTTP-Referer':'http://localhost:5173','X-Title':'Theote'},signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`Não foi possível consultar os preços de modelos OpenRouter (${response.status}).`);
  const payload=await response.json() as {data:Array<{id:string;pricing?:{prompt?:string;completion?:string}}>} ;
  prices=new Map(payload.data.map(item=>[item.id,{prompt:Number(item.pricing?.prompt),completion:Number(item.pricing?.completion)}]).filter(([,value])=>Number.isFinite(value.prompt)&&Number.isFinite(value.completion)));
  pricesUpdatedAt=Date.now();
  return prices;
}

function estimateMaximumCost(messages:ChatMessage[],tools:ToolDefinition[]|undefined,maxTokens:number,rate:ModelPrice) {
  if(rate.prompt<0||rate.completion<0)return 0.25;
  const characters=messages.reduce((total,item)=>total+item.content.length,0)+JSON.stringify(tools??[]).length;
  // Reserve a deliberately conservative prompt-token upper bound and the full output allowance.
  return (Math.ceil(characters/1.5)*rate.prompt+maxTokens*rate.completion)*1.25;
}

async function reserveBudget(maxCost:number) {
  if(!aiEnabled)throw new Error('IA pausada: configure chave, banco e limite mensal para permitir decisões.');
  if(maxCost<=0)throw new Error('O preço do modelo não está disponível; chamada bloqueada para proteger o limite.');
  const reservation=crypto.randomUUID();
  await db.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(470902)`;
    const [{spent}]=await tx`SELECT COALESCE(SUM(cost_usd),0)::float8 AS spent FROM model_usage WHERE created_at >= date_trunc('month',now())`;
    const [{reserved}]=await tx`SELECT COALESCE(SUM(reserved_usd),0)::float8 AS reserved FROM ai_cost_reservations WHERE created_at >= date_trunc('month',now())`;
    if(Number(spent)+Number(reserved)+maxCost>monthlyBudget)throw new Error('Limite mensal de OpenRouter atingido; as chamadas automáticas estão pausadas.');
    await tx`INSERT INTO ai_cost_reservations(id,reserved_usd) VALUES (${reservation},${maxCost})`;
  });
  return reservation;
}

export async function complete(options:{npcId:string|null;purpose:'decision'|'dialogue'|'summary';model:string;messages:ChatMessage[];tools?:ToolDefinition[];maxTokens:number;signal?:AbortSignal}) {
  const catalog=await modelPrices();
  const price=catalog.get(options.model);
  if(!price)throw new Error(`O modelo ${options.model} não aparece no catálogo de preços OpenRouter; chamada bloqueada.`);
  const maximumCost=estimateMaximumCost(options.messages,options.tools,options.maxTokens,price);
  // Free catalog prices can change; keep a temporary cushion until actual usage is reported.
  const reservation=await reserveBudget(maximumCost===0?0.05:maximumCost);
  try {
    const response=await openRouterFetch(`${BASE}/chat/completions`,{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'http://localhost:5173','X-Title':'Theote'},
      signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),
      body:JSON.stringify({model:options.model,messages:options.messages,max_tokens:options.maxTokens,temperature:options.purpose==='dialogue'?0.7:0.4,...(options.model===DECISION_FALLBACK_MODEL?{response_format:{type:'json_object'}}:{}),...(options.purpose==='dialogue'?{reasoning:{max_tokens:64},include_reasoning:false}:{}),...(options.tools?{tools:options.tools,tool_choice:'required'}:{})}),
    },false);
    const data=await response.json().catch(()=>({error:{message:response.statusText}})) as {error?:{message?:string};choices?:Array<{finish_reason?:string;message?:{content?:string|null;tool_calls?:Array<{function:{name:string;arguments:string}}>} }>;usage?:Usage};
    if(!response.ok)throw new Error(`OpenRouter ${response.status}: ${data.error?.message??'erro ao completar a solicitação'}`);
    const usage=data.usage??{};
    const prompt=Number(usage.prompt_tokens??0),completion=Number(usage.completion_tokens??0);
    const apiCost=usage.cost??usage.cost_details?.upstream_inference_cost;
    const actualCost=apiCost!==undefined&&Number.isFinite(Number(apiCost))&&Number(apiCost)>=0?Number(apiCost):price.prompt>=0&&price.completion>=0?prompt*price.prompt+completion*price.completion:maximumCost;
    await db`INSERT INTO model_usage(npc_id,purpose,model,prompt_tokens,completion_tokens,total_tokens,cost_usd)
      VALUES (${options.npcId},${options.purpose},${options.model},${prompt},${completion},${Number(usage.total_tokens??prompt+completion)},${actualCost})`;
    broadcast('usage_changed',{npcId:options.npcId,purpose:options.purpose});
    return {message:data.choices?.[0]?.message,finishReason:data.choices?.[0]?.finish_reason,usage:{prompt,completion,cost:actualCost}};
  } finally {
    await db`DELETE FROM ai_cost_reservations WHERE id=${reservation}`;
  }
}

export async function completeConversation(options:Omit<Parameters<typeof complete>[0],'model'|'purpose'>) {
  try {
    let result=await complete({...options,purpose:'dialogue',model:CHAT_MODEL});
    if(!result.message?.content?.trim()&&!options.signal?.aborted)result=await complete({...options,maxTokens:Math.max(768,options.maxTokens),purpose:'dialogue',model:CHAT_MODEL});
    return result;
  }
  catch(error) {
    if(!providerLimitError(error)||options.signal?.aborted)throw error;
    return complete({...options,purpose:'dialogue',model:CHAT_FALLBACK_MODEL});
  }
}

export type DecisionQuestion={id:string;instructions:string;yes:string;no:string};

async function rankWithModel(npcId:string,state:string,questions:DecisionQuestion[],model:string,signal?:AbortSignal) {
  if(!questions.length)throw new Error('Não há ações para avaliar.');
  const reservation=await reserveBudget(0.01);
  try {
    const response=await openRouterFetch('https://openrouter.ai/api/alpha/decisions',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'http://localhost:5173','X-Title':'Theote'},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),
      body:JSON.stringify({model,state,questions:Object.fromEntries(questions.map(question=>[question.id,{type:'noul',instructions:question.instructions,criteria:{true:question.yes,false:question.no}}]))}),
    },false);
    const data=await response.json().catch(()=>({error:{message:response.statusText}})) as {error?:{message?:string};answers?:Record<string,{type:string;noul:number}>;usage?:{input_tokens?:number;output_tokens?:number;cost?:number}};
    if(!response.ok)throw new Error(`OpenRouter ${response.status}: ${data.error?.message??'erro na decisão'}`);
    const scores=Object.fromEntries(questions.map(question=>[question.id,Number(data.answers?.[question.id]?.noul??0)]));
    const prompt=Number(data.usage?.input_tokens??0),completion=Number(data.usage?.output_tokens??0),cost=Number(data.usage?.cost??0.01);
    await db`INSERT INTO model_usage(npc_id,purpose,model,prompt_tokens,completion_tokens,total_tokens,cost_usd) VALUES (${npcId},'decision',${model},${prompt},${completion},${prompt+completion},${cost})`;
    broadcast('usage_changed',{npcId,purpose:'decision'});
    return scores;
  } finally { await db`DELETE FROM ai_cost_reservations WHERE id=${reservation}`; }
}

async function rankWithChatFallback(npcId:string,state:string,questions:DecisionQuestion[],signal?:AbortSignal) {
  const result=await complete({
    npcId,purpose:'decision',model:DECISION_FALLBACK_MODEL,maxTokens:1200,signal,
    messages:[
      {role:'system',content:'Avalie as possibilidades de uma pessoa real no mundo descrito. Responda somente com um objeto JSON: cada chave é o ID exato de uma possibilidade e cada valor é um número entre 0 e 1. Para ações, compare qual é o próximo passo mais coerente. Para sentimentos, avalie cada um independentemente. Não invente IDs nem inclua explicações.'},
      {role:'user',content:`${state}\n\nPossibilidades:\n${JSON.stringify(questions.map(({id,instructions,yes,no})=>({id,instructions,yes,no})))}`},
    ],
  });
  const content=result.message?.content;
  if(!content)throw new Error('O fallback de decisões não retornou pontuações.');
  let parsed:unknown;
  try { parsed=JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,'')); }
  catch { throw new Error('O fallback de decisões retornou JSON inválido.'); }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('O fallback de decisões retornou pontuações inválidas.');
  const answers=parsed as Record<string,unknown>;
  const scores:Record<string,number>={};
  for(const question of questions){
    const value=answers[question.id];
    scores[question.id]=typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
  }
  if(!questions.some(question=>typeof answers[question.id]==='number'&&Number.isFinite(answers[question.id])))throw new Error('O fallback de decisões não pontuou nenhuma possibilidade.');
  return scores;
}

export async function rankDecisions(npcId:string,state:string,questions:DecisionQuestion[],signal?:AbortSignal) {
  try { return await rankWithModel(npcId,state,questions,DECISION_MODEL,signal); }
  catch(error) {
    if(!providerLimitError(error)||signal?.aborted)throw error;
    return rankWithChatFallback(npcId,state,questions,signal);
  }
}

export const models={decision:DECISION_MODEL,conversation:CHAT_MODEL,decisionFallback:DECISION_FALLBACK_MODEL,conversationFallback:CHAT_FALLBACK_MODEL,summary:'local'};

export async function getBudgetStatus() {
  const [row]=await db`SELECT COALESCE((SELECT SUM(cost_usd) FROM model_usage WHERE created_at>=date_trunc('month',now())),0)::float8 AS spent,
    COALESCE((SELECT SUM(reserved_usd) FROM ai_cost_reservations WHERE created_at>=date_trunc('month',now())),0)::float8 AS reserved`;
  const spent=Number(row.spent),reserved=Number(row.reserved);
  return {enabled:aiEnabled,budgetUsd:monthlyBudget,spentUsd:spent,reservedUsd:reserved,remainingUsd:Math.max(0,monthlyBudget-spent-reserved),paused:!aiEnabled||spent+reserved>=monthlyBudget,models};
}
