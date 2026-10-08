import { db, initializeDatabase } from './database';
import { getWorldClock } from './clock';
import { startScheduler } from './simulation';
import { aiEnabled, getBudgetStatus } from './openrouter';
import { addClient, broadcast, removeClient } from './realtime';
import { listAgreements } from './agreements';
import { listInvitations } from './invitations';
import { listGoblinTorments } from './goblin';

const port=Number(process.env.PORT??3001);
const profiles=await Bun.file(new URL('../../../packages/npcs/data/characters.json',import.meta.url)).json() as Array<{id:string;name:string;home:string;position:number[];personality:string[];appearance:unknown}>;
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL não foi configurada em apps/api/.env.');
await initializeDatabase();
const stopScheduler=await startScheduler();
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

async function getState() {
  const [clock,state]=await Promise.all([getWorldClock(),db`SELECT started_at FROM world_state WHERE id=1`]);
  const npcs=await db`SELECT id,name,home_id,x,z,mode,emotion,stamina,hunger,thirst,coins,departed_at,goal_x,goal_z,goal_person_id,last_decision_at,next_thought_at,planned_wake_at FROM npc_state ORDER BY id`;
  const budget=await getBudgetStatus();
  return {world:{startedAt:state[0].started_at,day:clock.day,hour:clock.hour,minute:clock.minute,phase:clock.phase,elapsedSeconds:clock.elapsedSeconds},npcs,budget};
}

async function getUsage(url:URL) {
  const [{usage_report_started_at:reportStartedAt}]=await db`SELECT usage_report_started_at FROM world_state WHERE id=1`;
  const requestedPeriod=url.searchParams.get('period')??'month';
  const period=['day','month','all'].includes(requestedPeriod)?requestedPeriod:'month';
  const npc=url.searchParams.get('npc')??'all';
  const model=url.searchParams.get('model')??'all';
  const purpose=url.searchParams.get('purpose')??'all';
  const start:'today'|'month'|null=period==='day'?'today':period==='month'?'month':null;
  const filters=await db`SELECT COALESCE(SUM(prompt_tokens),0)::int AS prompt_tokens,COALESCE(SUM(completion_tokens),0)::int AS completion_tokens,COALESCE(SUM(total_tokens),0)::int AS total_tokens,COALESCE(SUM(cost_usd),0)::float8 AS cost_usd,COUNT(*)::int AS requests FROM model_usage
    WHERE created_at>=${reportStartedAt} AND (${start===null} OR created_at>=date_trunc(${start==='today'?'day':'month'},now()))
      AND (${npc==='all'} OR npc_id=${npc}) AND (${model==='all'} OR model=${model}) AND (${purpose==='all'} OR purpose=${purpose})`;
  const daily=await db`SELECT to_char(created_at::date,'YYYY-MM-DD') AS date,COALESCE(SUM(total_tokens),0)::int AS tokens,COALESCE(SUM(cost_usd),0)::float8 AS cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='respan/span-01-lite'),0)::float8 AS respan_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='typesafe/jev-router'),0)::float8 AS jev_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='typesafe/jev-1.13'),0)::float8 AS jev_113_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='openai/gpt-4.1-nano'),0)::float8 AS nano_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='inclusionai/ling-3.1-flash'),0)::float8 AS ling_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='mistralai/mistral-nemo'),0)::float8 AS mistral_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model='qwen/qwen3.7-flash'),0)::float8 AS qwen_cost_usd,
    COALESCE(SUM(cost_usd) FILTER (WHERE model NOT IN ('respan/span-01-lite','typesafe/jev-router','typesafe/jev-1.13','openai/gpt-4.1-nano','inclusionai/ling-3.1-flash','mistralai/mistral-nemo','qwen/qwen3.7-flash')),0)::float8 AS other_cost_usd,
    COUNT(*)::int AS requests FROM model_usage
    WHERE created_at>=${reportStartedAt} AND (${start===null} OR created_at>=date_trunc(${start==='today'?'day':'month'},now()))
      AND (${npc==='all'} OR npc_id=${npc}) AND (${model==='all'} OR model=${model}) AND (${purpose==='all'} OR purpose=${purpose})
    GROUP BY created_at::date ORDER BY created_at::date`;
  const characters=await db`SELECT COALESCE(n.name,'Sem personagem') AS character,n.id AS npc_id,COALESCE(SUM(u.total_tokens),0)::int AS tokens,COALESCE(SUM(u.cost_usd),0)::float8 AS cost_usd,COUNT(u.id)::int AS requests FROM model_usage u LEFT JOIN npc_state n ON n.id=u.npc_id
    WHERE u.created_at>=${reportStartedAt} AND (${start===null} OR u.created_at>=date_trunc(${start==='today'?'day':'month'},now())) AND (${model==='all'} OR u.model=${model}) AND (${purpose==='all'} OR u.purpose=${purpose})
    GROUP BY n.id,n.name ORDER BY cost_usd DESC`;
  const models=await db`SELECT model,purpose,COALESCE(SUM(total_tokens),0)::int AS tokens,COALESCE(SUM(cost_usd),0)::float8 AS cost_usd,COUNT(*)::int AS requests FROM model_usage
    WHERE created_at>=${reportStartedAt} AND (${start===null} OR created_at>=date_trunc(${start==='today'?'day':'month'},now())) AND (${npc==='all'} OR npc_id=${npc}) AND (${purpose==='all'} OR purpose=${purpose})
    GROUP BY model,purpose ORDER BY cost_usd DESC`;
  return {period,reportStartedAt,filters:filters[0],daily,characters,models,budget:await getBudgetStatus()};
}

const hostname=process.env.HOST??'127.0.0.1';
const server=Bun.serve({hostname,port,websocket:{
  open(ws){addClient(ws);void getState().then(state=>ws.send(JSON.stringify({type:'state',payload:state}))).catch(()=>{});},
  close(ws){removeClient(ws);},
  message(){},
},async fetch(request,server) {
  const url=new URL(request.url),path=url.pathname;
  try {
    if(path==='/ws')return server.upgrade(request)?undefined:json({error:'Não foi possível abrir o WebSocket.'},400);
    if(request.method==='GET'&&path==='/api/health')return json({ok:true,service:'theote-api',aiEnabled});
    if(request.method==='GET'&&path==='/api/state')return json(await getState());
    if(request.method==='GET'&&path==='/api/npcs')return json(profiles);
    if(request.method==='GET'&&path.startsWith('/api/npcs/')&&path.endsWith('/activity')) {
      const npcId=decodeURIComponent(path.slice('/api/npcs/'.length,-'/activity'.length));
      if(!profiles.some(profile=>profile.id===npcId))return json({error:'Morador não encontrado.'},404);
      const [npc]=await db`SELECT id,name,profile,mode,emotion,stamina,hunger,thirst,coins,departed_at,last_decision_at FROM npc_state WHERE id=${npcId}`;
      const [memory]=await db`SELECT summary,last_summarized_day,updated_at FROM npc_memories WHERE npc_id=${npcId}`;
      const decisions=await db`SELECT id,world_day,action,arguments,outcome,thought,created_at FROM npc_decisions WHERE npc_id=${npcId} ORDER BY id DESC LIMIT 50`;
      const dialogue=await db`SELECT m.id,m.world_day,m.world_hour,m.world_minute,m.speaker_name,m.content,m.created_at,m.reply_to_message_id,quoted.speaker_name AS reply_to_speaker_name,quoted.content AS reply_to_content FROM dialogue_messages m LEFT JOIN dialogue_messages quoted ON quoted.id=m.reply_to_message_id WHERE m.participants @> ${db.json([npcId])} ORDER BY m.id DESC LIMIT 100`;
      const [affect]=await db`SELECT mood,pressure,valence FROM npc_affect WHERE npc_id=${npcId}`;
      const bonds=await db`SELECT n.name,b.other_id,b.warmth,b.trust,b.tension FROM npc_bonds b JOIN npc_state n ON n.id=b.other_id WHERE b.npc_id=${npcId} ORDER BY n.name`;
      const feelings=await db`SELECT f.id,f.world_day,f.emotion,f.intensity,f.cause,f.other_id,n.name AS other_name FROM npc_feeling_events f LEFT JOIN npc_state n ON n.id=f.other_id WHERE f.npc_id=${npcId} ORDER BY f.id DESC LIMIT 100`;
      const bondEmotions=await db`SELECT other_id,emotion,SUM(intensity)::int AS strength,COUNT(*)::int AS occurrences FROM npc_feeling_events WHERE npc_id=${npcId} AND other_id IS NOT NULL GROUP BY other_id,emotion ORDER BY strength DESC`;
      const coins=await db`SELECT id,other_id,kind,amount,world_day,balance_after,created_at FROM npc_coin_events WHERE npc_id=${npcId} ORDER BY id DESC LIMIT 50`;
      const inventory=await db`SELECT item_id,quantity FROM npc_inventory WHERE npc_id=${npcId} AND quantity>0 ORDER BY item_id`;
      const itemEvents=await db`SELECT id,other_id,item_id,kind,world_day,need_before,need_after,joy_gain,created_at FROM npc_item_events WHERE npc_id=${npcId} ORDER BY id DESC LIMIT 50`;
      const memoryEvents=await db`SELECT id,kind,subject,summary,importance,world_day,created_at FROM npc_memory_events WHERE npc_id=${npcId} ORDER BY id DESC LIMIT 80`;
      const explorations=await db`SELECT site_id,discovery,world_day,created_at FROM npc_explorations WHERE npc_id=${npcId} ORDER BY world_day DESC,site_id`;
      const beliefs=await db`SELECT topic,stance,reason,updated_at FROM npc_beliefs WHERE npc_id=${npcId} ORDER BY topic`;
      const notifications=await db`SELECT id,message,created_at,delivered_at FROM npc_notifications WHERE npc_id=${npcId} ORDER BY id DESC LIMIT 30`;
      const invitations=await listInvitations(npcId);
      const agreements=(await listAgreements()).filter(item=>item.proposer_id===npcId||item.recipient_id===npcId);
      return json({npc,memory,affect,bonds,feelings,bondEmotions,coins,inventory,itemEvents,memoryEvents,explorations,beliefs,notifications,invitations,agreements,decisions:decisions.reverse(),dialogue:dialogue.reverse()});
    }
    if(request.method==='GET'&&path==='/api/dialogues') {
      const npcId=url.searchParams.get('npc');
      const rows=npcId?await db`SELECT m.id,m.world_day,m.world_hour,m.world_minute,m.from_npc_id,m.to_npc_id,m.participants,m.speaker_name,m.content,m.created_at,m.reply_to_message_id,quoted.speaker_name AS reply_to_speaker_name,quoted.content AS reply_to_content FROM dialogue_messages m LEFT JOIN dialogue_messages quoted ON quoted.id=m.reply_to_message_id WHERE m.participants @> ${db.json([npcId])} ORDER BY m.id DESC LIMIT 200`:await db`SELECT m.id,m.world_day,m.world_hour,m.world_minute,m.from_npc_id,m.to_npc_id,m.participants,m.speaker_name,m.content,m.created_at,m.reply_to_message_id,quoted.speaker_name AS reply_to_speaker_name,quoted.content AS reply_to_content FROM dialogue_messages m LEFT JOIN dialogue_messages quoted ON quoted.id=m.reply_to_message_id ORDER BY m.id DESC LIMIT 200`;
      return json(rows.reverse());
    }
    if(request.method==='GET'&&path==='/api/agreements')return json(await listAgreements());
    if(request.method==='GET'&&path==='/api/invitations')return json(await listInvitations(url.searchParams.get('npc')??undefined));
    if(request.method==='GET'&&path==='/api/goblin/torments')return json(await listGoblinTorments());
    if(request.method==='GET'&&path==='/api/usage')return json(await getUsage(url));
    return json({error:'Não encontrado.'},404);
  } catch(error) {
    const message=error instanceof Error?error.message:'Falha inesperada.';
    const status=message.includes('Limite mensal')?429:message.includes('Morador não encontrado')?404:message.includes('nenhum texto')?400:502;
    console.error(`[Theote API] ${request.method} ${path}: ${message}`);
    return json({error:message},status);
  }
}});

const realtimeState=setInterval(()=>void getState().then(state=>broadcast('state',state)).catch(error=>console.error('[Theote] estado em tempo real:',error instanceof Error?error.message:'erro')),1000);

console.info(`[Theote] API pronta em http://${hostname}:${server.port}`);
const shutdown=()=>{clearInterval(realtimeState);stopScheduler();void db.end();server.stop();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
