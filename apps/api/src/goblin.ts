import { CHAINED_GOBLIN } from '@theote/npcs/worldLayout';
import { db } from './database';
import { getWorldClock } from './clock';
import { completeConversation } from './openrouter';
import { broadcast } from './realtime';
import { BELIEF_LABELS, type BeliefTopic } from './memory';

const claims:[BeliefTopic,string,string][]=[
  ['walls','questione se as muralhas bastam para proteger a vila','Por que você olha tanto para as muralhas?'],
  ['cesar','insinue que Cesar talvez não tenha contado tudo sobre o Abalo','Você conheceu Cesar?'],
  ['outside','insinue que o medo do exterior pode limitar as escolhas dos moradores','O que existe além da muralha?'],
];

export async function talkToGoblin(npcId:string,signal?:AbortSignal) {
  const [npc]=await db`SELECT id,name,x,z,mode FROM npc_state WHERE id=${npcId}`;
  if(!npc||npc.mode==='departed'||Math.hypot(npc.x-CHAINED_GOBLIN.approachX,npc.z-CHAINED_GOBLIN.approachZ)>2.2)throw new Error('É preciso estar no ponto seguro diante do duende.');
  const [{visits}]=await db`SELECT COUNT(*)::int AS visits FROM dialogue_messages WHERE speaker_name='Duende' AND participants @> ${db.json([npcId,'goblin'])}`;
  const [topic,instruction,question]=claims[Number(visits)%claims.length];
  const [affect]=await db`SELECT pressure FROM npc_affect WHERE npc_id=${npcId}`;
  const recent=await db`SELECT speaker_name,content FROM dialogue_messages WHERE participants @> ${db.json([npcId,'goblin'])} ORDER BY id DESC LIMIT 6`;
  const result=await completeConversation({npcId:null,maxTokens:260,signal,messages:[
    {role:'system',content:'Você é o duende acorrentado no canto da muralha. Fala em português, com frieza, humor sombrio e manipulação sutil. Quer que o visitante questione uma crença sua. Você não pode sair da corrente, tocar na pessoa nem afirmar como fato algo que não viu. Não use ameaças explícitas, narração, saudações ou explicações sobre IA. Responda em até duas frases curtas.'},
    {role:'user',content:`${npc.name} parou a uma distância segura e perguntou: “${question}”. Sua intenção nesta conversa: ${instruction}. Crença atual da pessoa: “${BELIEF_LABELS[topic]}”. Falas anteriores: ${recent.reverse().map(row=>`${row.speaker_name}: ${row.content}`).join(' | ')||'nenhuma'}. Diga uma insinuação específica, sem repetir as anteriores.`},
  ]});
  const answer=String(result.message?.content??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,280);
  if(!answer)throw new Error('O duende permaneceu em silêncio.');
  signal?.throwIfAborted();
  const {day,hour,minute}=await getWorldClock();
  const influence=Math.min(18,8+Math.round(Number(affect?.pressure??0)/10));
  const messages=await db.begin(async tx=>{
    const [fresh]=await tx`SELECT x,z,mode FROM npc_state WHERE id=${npcId} FOR UPDATE`;
    if(!fresh||fresh.mode==='departed'||Math.hypot(fresh.x-CHAINED_GOBLIN.approachX,fresh.z-CHAINED_GOBLIN.approachZ)>2.2)throw new Error('A pessoa se afastou antes da resposta.');
    const participants=['goblin',npcId].sort();
    const [asked]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants) VALUES (${day},${hour},${minute},${npcId},${null},${npc.name},${question},${tx.json(participants)}) RETURNING id,created_at`;
    const [answered]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id) VALUES (${day},${hour},${minute},${null},${npcId},'Duende',${answer},${tx.json(participants)},${asked.id}) RETURNING id,created_at`;
    await tx`UPDATE npc_beliefs SET stance=GREATEST(-100,stance-${influence}),reason=${`O duende disse: “${answer}”`},updated_at=now() WHERE npc_id=${npcId} AND topic=${topic}`;
    await tx`UPDATE npc_affect SET mood='suspicion',pressure=LEAST(100,pressure+3),valence=GREATEST(-100,valence-2),updated_at=now() WHERE npc_id=${npcId}`;
    await tx`INSERT INTO npc_feeling_events(npc_id,world_day,emotion,intensity,cause) VALUES (${npcId},${day},'suspicion',1,${'Conversa com o duende acorrentado.'})`;
    await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${npcId},'goblin',${topic},${`Conversei à distância com o duende; ele disse “${answer}”. Passei a questionar: ${BELIEF_LABELS[topic]}.`},4,${day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary,created_at=now()`;
    return {asked,answered,participants};
  });
  for(const [message,speakerId,speakerName,content,reply] of [[messages.asked,npcId,npc.name,question,null],[messages.answered,null,'Duende',answer,messages.asked]] as const)
    broadcast('dialogue',{id:Number(message.id),world_day:day,world_hour:hour,world_minute:minute,from_npc_id:speakerId,to_npc_id:speakerId?null:npcId,participants:messages.participants,speaker_name:speakerName,content,created_at:message.created_at,reply_to_message_id:reply?Number(reply.id):null,reply_to_speaker_name:reply?npc.name:null,reply_to_content:reply?question:null});
  broadcast('agent_event',{npcId,npcName:npc.name,stage:'goblin',status:'completed',outcome:`Conversou com o duende e passou a questionar: ${BELIEF_LABELS[topic]}.`,at:new Date().toISOString()});
  return `Ouviu o duende de longe: “${answer}”. Sua opinião sobre “${BELIEF_LABELS[topic]}” mudou ${influence} pontos.`;
}
