import { CHAINED_GOBLIN } from '@theote/npcs/worldLayout';
import { db } from './database';
import { getWorldClock } from './clock';
import { completeConversation, getBudgetStatus, rankDecisions, type DecisionQuestion } from './openrouter';
import { broadcast } from './realtime';
import { BELIEF_LABELS, type BeliefTopic } from './memory';

type TormentKind='rumor'|'lure'|'demand'|'doubt';
const kinds:TormentKind[]=['rumor','lure','demand','doubt'];
const topics:BeliefTopic[]=['walls','cesar','outside'];
const clean=(value:unknown)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,280);

function tormentPlan(kind:TormentKind,name:string,otherName:string,topic:BeliefTopic) {
  switch(kind) {
    case 'rumor':return {intent:`Minta deliberadamente a ${name}: afirme que ${otherName} disse que não confia mais em ${name}. Peça que ${name} procure ${otherName} para cobrar uma explicação.`,fallback:`${otherName} me disse que já não confia em você. Vai perguntar por quê, ou prefere fingir que não ouviu?`};
    case 'lure':return {intent:`Chame ${name} até a parte segura diante de suas correntes. Insinue que sabe algo que só contará de perto.`,fallback:`${name}, venha até a barreira. Tenho algo que você precisa ouvir antes que os outros decidam por você.`};
    case 'demand':return {intent:`Peça a ${name} que procure ${otherName} e lhe faça uma pergunta desconfortável sobre o que esconde da vila. Sugira uma suspeita sem prova.`,fallback:`Procure ${otherName} e pergunte o que anda escondendo de você. Preste atenção na primeira reação.`};
    case 'doubt':return {intent:`Abale a convicção de ${name} sobre “${BELIEF_LABELS[topic]}”. Insinue uma conclusão sem prova e peça que observe por si.`,fallback:`Tem tanta certeza de que ${BELIEF_LABELS[topic].toLocaleLowerCase('pt-BR')}? Olhe de novo antes de repetir o que todos dizem.`};
  }
}

async function issueTorment(npcId:string,kind:TormentKind,namedNpcId:string|null,topic:BeliefTopic,replyToMessageId:number|null=null,signal?:AbortSignal) {
  const [npc]=await db`SELECT id,name,mode FROM npc_state WHERE id=${npcId}`;
  if(!npc||npc.mode==='departed')throw new Error('O duende não encontrou essa pessoa no vale.');
  const [other]=namedNpcId?await db`SELECT id,name FROM npc_state WHERE id=${namedNpcId}`:[];
  const plan=tormentPlan(kind,npc.name,other?.name??'alguém da vila',topic);
  const previous=await db`SELECT content FROM dialogue_messages WHERE speaker_name='Duende' AND to_npc_id=${npcId} ORDER BY id DESC LIMIT 3`;
  let content=plan.fallback;
  try {
    const result=await completeConversation({npcId:null,maxTokens:150,signal,messages:[
      {role:'system',content:'Você é o duende acorrentado no canto da muralha. Seu tom é sombrio, íntimo e manipulador. Pode mentir, inventar uma fala alheia e pedir ações para semear desconfiança. Nunca revela que segue tarefas de tormento. Não sai das correntes, não ameaça fisicamente e não fala de IA. Escreva apenas uma fala em português natural, com até duas frases curtas, sem saudação.'},
      {role:'user',content:`Fale com ${npc.name}. Sua intenção escondida: ${plan.intent} Falas recentes para não repetir: ${previous.map(row=>row.content).join(' | ')||'nenhuma'}.`},
    ]});
    const generated=clean(result.message?.content);
    content=(kind==='rumor'||kind==='demand')&&other&&!generated.includes(other.name)?plan.fallback:generated||content;
  } catch(error) {
    if(signal?.aborted)throw error;
    console.error('[Theote] fala do duende:',error instanceof Error?error.message:'falha');
  }
  signal?.throwIfAborted();
  const {day,hour,minute}=await getWorldClock();
  const participants=['goblin',npcId].sort();
  const [saved]=await db.begin(async tx=>{
    const [message]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id)
      VALUES (${day},${hour},${minute},${null},${npcId},'Duende',${content},${tx.json(participants)},${replyToMessageId}) RETURNING id,created_at`;
    await tx`INSERT INTO goblin_torments(message_id,npc_id,kind,named_npc_id,topic) VALUES (${message.id},${npcId},${kind},${namedNpcId},${topic})`;
    await tx`INSERT INTO npc_notifications(npc_id,message,dialogue_message_id) VALUES (${npcId},${`O duende chamou você: “${content}” Decida o que pensa, se quer guardar isso e se seguirá o pedido.`},${message.id})`;
    await tx`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${npcId}`;
    return [message];
  });
  broadcast('dialogue',{id:Number(saved.id),world_day:day,world_hour:hour,world_minute:minute,from_npc_id:null,to_npc_id:npcId,participants,speaker_name:'Duende',content,created_at:saved.created_at,reply_to_message_id:replyToMessageId,reply_to_speaker_name:replyToMessageId?npc.name:null});
  broadcast('agent_event',{npcId,npcName:npc.name,stage:'goblin',status:'started',outcome:'O duende chamou essa pessoa do canto da muralha.',at:new Date().toISOString()});
  return content;
}

export async function maybeSendGoblinTorment() {
  if((await getBudgetStatus()).paused)return null;
  const [last]=await db`SELECT created_at FROM goblin_torments ORDER BY created_at DESC LIMIT 1`;
  if(last&&Date.now()-new Date(last.created_at).getTime()<120_000)return null;
  const candidates=await db`SELECT n.id,n.name,n.x,n.z,MAX(t.created_at) AS last_visit
    FROM npc_state n LEFT JOIN goblin_torments t ON t.npc_id=n.id
    WHERE n.mode NOT IN ('sleeping','departed') AND sqrt(power(n.x-${CHAINED_GOBLIN.x},2)+power(n.z-${CHAINED_GOBLIN.z},2))<=60
      AND NOT EXISTS (SELECT 1 FROM goblin_torments open WHERE open.npc_id=n.id AND open.decided_at IS NULL)
    GROUP BY n.id ORDER BY last_visit ASC NULLS FIRST,sqrt(power(n.x-${CHAINED_GOBLIN.x},2)+power(n.z-${CHAINED_GOBLIN.z},2)) ASC LIMIT 4`;
  if(!candidates.length)return null;
  const [{count}]=await db`SELECT COUNT(*)::int AS count FROM goblin_torments`;
  const target=candidates[Number(count)%candidates.length];
  const kind=kinds[Number(count)%kinds.length],topic=topics[Number(count)%topics.length];
  const others=await db`SELECT id FROM npc_state WHERE id<>${target.id} AND mode<>'departed' ORDER BY id`;
  const other=others[Number(count)%others.length];
  await issueTorment(target.id,kind,other?.id??null,topic);
  return target.id as string;
}

export async function talkToGoblin(npcId:string,signal?:AbortSignal) {
  const [npc]=await db`SELECT id,name,x,z,mode FROM npc_state WHERE id=${npcId}`;
  if(!npc||npc.mode==='departed'||Math.hypot(npc.x-CHAINED_GOBLIN.approachX,npc.z-CHAINED_GOBLIN.approachZ)>2.2)throw new Error('É preciso estar no ponto seguro diante do duende.');
  const {day,hour,minute}=await getWorldClock();
  const participants=['goblin',npcId].sort();
  const [asked]=await db`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants)
    VALUES (${day},${hour},${minute},${npcId},${null},${npc.name},'O que você quer de mim?',${db.json(participants)}) RETURNING id,created_at`;
  broadcast('dialogue',{id:Number(asked.id),world_day:day,world_hour:hour,world_minute:minute,from_npc_id:npcId,to_npc_id:null,participants,speaker_name:npc.name,content:'O que você quer de mim?',created_at:asked.created_at});
  const [{count}]=await db`SELECT COUNT(*)::int AS count FROM goblin_torments`;
  const kind=kinds[Number(count)%kinds.length],topic=topics[Number(count)%topics.length];
  const [other]=await db`SELECT id FROM npc_state WHERE id<>${npcId} AND mode<>'departed' ORDER BY id LIMIT 1`;
  const answer=await issueTorment(npcId,kind,other?.id??null,topic,Number(asked.id),signal);
  return `O duende respondeu: “${answer}”. ${npc.name} decidirá o que fazer com isso.`;
}

export async function considerGoblinTorment(npcId:string,messageId:number,signal?:AbortSignal) {
  const [event]=await db`SELECT t.*,m.content,n.name,n.profile,b.stance AS current_stance,other.name AS other_name
    FROM goblin_torments t JOIN dialogue_messages m ON m.id=t.message_id JOIN npc_state n ON n.id=t.npc_id
    LEFT JOIN npc_beliefs b ON b.npc_id=t.npc_id AND b.topic=t.topic LEFT JOIN npc_state other ON other.id=t.named_npc_id
    WHERE t.message_id=${messageId} AND t.npc_id=${npcId}`;
  if(!event||event.decided_at)return null;
  const [memory]=await db`SELECT summary FROM npc_memories WHERE npc_id=${npcId}`;
  const context=event.named_npc_id?await db`SELECT speaker_name,content FROM dialogue_messages WHERE participants @> ${db.json([npcId,event.named_npc_id])} ORDER BY id DESC LIMIT 4`:[];
  const questions:DecisionQuestion[]=[
    {id:'believe',instructions:'Acreditar na alegação do duende como provavelmente verdadeira.',yes:'A fala parece convincente para esta pessoa, mesmo sem confirmação.',no:'A fonte é duvidosa ou os fatos conhecidos contradizem a alegação.'},
    {id:'remember',instructions:'Guardar na memória a conversa com o duende.',yes:'Mesmo que eu duvide, vale lembrar que ele fez essa alegação para avaliar depois.',no:'Prefiro não conservar essa fala nas minhas lembranças duradouras.'},
    {id:'follow',instructions:'Seguir o pedido ou investigar a pessoa mencionada.',yes:'Quero agir agora por curiosidade, preocupação ou confiança.',no:'Não quero seguir o pedido do duende agora.'},
  ];
  const state=`${event.profile.systemPrompt}\nSua memória: ${memory?.summary??'Ainda está conhecendo a vila.'}\nO duende acorrentado chamou você e disse: “${event.content}”. Você não viu prova dessa alegação. Você conhece o duende como alguém obscuro e sabe que uma fala pode ser verdadeira ou inventada. Não conhece as intenções escondidas dele. ${event.other_name?`A pessoa mencionada é ${event.other_name}.`:''} ${event.topic?`Sua opinião atual sobre ${BELIEF_LABELS[event.topic as BeliefTopic]} está em ${event.current_stance??0}/100.`:''} Conversas suas recentes com a pessoa mencionada: ${context.reverse().map(row=>`${row.speaker_name}: ${row.content}`).join(' | ')||'nenhuma'}. Decida separadamente se acredita, se quer guardar a alegação como lembrança e se seguirá o pedido. Guardar a alegação não a torna verdadeira.`;
  const scores=await rankDecisions(npcId,state,questions,signal);
  signal?.throwIfAborted();
  if(!questions.some(question=>Number(scores[question.id]??0)>0))throw new Error('A decisão sobre o duende não veio completa.');
  const believed=Number(scores.believe??0)>=0.6,remembered=Number(scores.remember??0)>=0.55,followed=Number(scores.follow??0)>=0.65;
  const {day,hour,minute}=await getWorldClock();
  const outcome=`${believed?'Acreditou':'Duvidou'} do duende; ${remembered?'guardou a alegação':'não a guardou na memória'}; ${followed?'decidiu investigar ou atender ao chamado':'não seguiu o pedido'}.`;
  let reply=believed?'Isso muda o que eu pensava. Vou olhar com meus próprios olhos.':'Você quer que eu aceite isso só porque falou? Preciso pensar.';
  try {
    const result=await completeConversation({npcId,maxTokens:100,signal,messages:[
      {role:'system',content:`${event.profile.systemPrompt}\nSeu jeito de falar: ${event.profile.speechStyle??''}. Responda diretamente ao duende em português natural, em uma frase curta. Você ${believed?'considerou a alegação plausível':'duvidou da alegação'} e ${followed?'decidiu agir':'não decidiu agir'}. Não revele sua escolha sobre guardar na memória. Não afirme como fato o que ainda não foi confirmado. Sem saudação nem narração.`},
      {role:'user',content:`O duende disse: “${event.content}”. Sua resposta:`},
    ]});
    reply=clean(result.message?.content)||reply;
  } catch(error) {
    if(signal?.aborted)throw error;
    console.error('[Theote] resposta ao duende:',error instanceof Error?error.message:'falha');
  }
  signal?.throwIfAborted();
  const saved=await db.begin(async tx=>{
    const [claimed]=await tx`UPDATE goblin_torments SET believed=${believed},remembered=${remembered},followed=${followed},decided_at=now()
      WHERE message_id=${messageId} AND npc_id=${npcId} AND decided_at IS NULL RETURNING message_id`;
    if(!claimed)return null;
    if(remembered)await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day)
      VALUES (${npcId},'goblin',${String(messageId)},${`O duende alegou: “${clean(event.content)}”. ${believed?'Achei possível.':'Não confirmei se era verdade.'}`},${believed?3:2},${day})`;
    if(believed&&event.kind==='doubt'&&event.topic)await tx`UPDATE npc_beliefs SET stance=GREATEST(-100,stance-8),reason=${`Acreditei na insinuação do duende: “${clean(event.content)}”`},updated_at=now() WHERE npc_id=${npcId} AND topic=${event.topic}`;
    if(believed&&event.named_npc_id&&(event.kind==='rumor'||event.kind==='demand'))await tx`UPDATE npc_bonds SET trust=GREATEST(0,trust-5),tension=LEAST(100,tension+6),updated_at=now() WHERE npc_id=${npcId} AND other_id=${event.named_npc_id}`;
    if(followed){
      const [person]=event.named_npc_id?await tx`SELECT x,z,id FROM npc_state WHERE id=${event.named_npc_id}`:[];
      const target=event.kind==='lure'||event.kind==='doubt'?{x:CHAINED_GOBLIN.approachX,z:CHAINED_GOBLIN.approachZ,id:null}:person;
      if(target)await tx`UPDATE npc_state SET goal_x=${target.x},goal_z=${target.z},goal_person_id=${target.id},mode='walking',next_thought_at=NULL,updated_at=now() WHERE id=${npcId} AND mode<>'sleeping'`;
    }
    await tx`INSERT INTO npc_decisions(npc_id,world_day,action,arguments,outcome) VALUES (${npcId},${day},'consider_goblin_claim',${tx.json({messageId,believed,remembered,followed})},${outcome})`;
    const [message]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id)
      VALUES (${day},${hour},${minute},${npcId},${null},${event.name},${reply},${tx.json(['goblin',npcId].sort())},${messageId}) RETURNING id,created_at`;
    return message;
  });
  if(!saved)return null;
  broadcast('dialogue',{id:Number(saved.id),world_day:day,world_hour:hour,world_minute:minute,from_npc_id:npcId,to_npc_id:null,participants:['goblin',npcId].sort(),speaker_name:event.name,content:reply,created_at:saved.created_at,reply_to_message_id:messageId,reply_to_speaker_name:'Duende',reply_to_content:event.content});
  broadcast('agent_event',{npcId,npcName:event.name,stage:'goblin',status:'completed',outcome,at:new Date().toISOString()});
  return outcome;
}

export async function listGoblinTorments() {
  return db`SELECT t.message_id,t.kind,t.npc_id,n.name AS npc_name,t.named_npc_id,other.name AS named_npc_name,
    t.believed,t.remembered,t.followed,t.created_at,t.decided_at,m.content
    FROM goblin_torments t JOIN dialogue_messages m ON m.id=t.message_id JOIN npc_state n ON n.id=t.npc_id
    LEFT JOIN npc_state other ON other.id=t.named_npc_id ORDER BY t.message_id DESC LIMIT 100`;
}
