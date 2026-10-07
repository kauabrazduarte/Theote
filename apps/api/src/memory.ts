import { db } from './database';

export const BELIEF_LABELS={
  walls:'As muralhas protegem a vila',
  cesar:'Cesar contou a verdade sobre o Abalo',
  outside:'O mundo exterior é perigoso',
} as const;
export type BeliefTopic=keyof typeof BELIEF_LABELS;

export async function recall(npcId:string,nearbyIds:string[]=[]) {
  const [events,beliefs,explorations]=await Promise.all([
    db`SELECT kind,subject,summary,importance,world_day FROM npc_memory_events WHERE npc_id=${npcId} ORDER BY world_day DESC,id DESC LIMIT 60`,
    db`SELECT topic,stance,reason FROM npc_beliefs WHERE npc_id=${npcId} ORDER BY topic`,
    db`SELECT site_id,discovery,world_day FROM npc_explorations WHERE npc_id=${npcId} ORDER BY world_day DESC LIMIT 12`,
  ]);
  const selected=events.sort((a,b)=>{
    const score=(item:typeof a)=>Number(item.importance)*10+(nearbyIds.some(id=>String(item.subject).split(':').includes(id))?15:0)+Number(item.world_day)*0.1;
    return score(b)-score(a);
  }).slice(0,10);
  return {
    text:selected.map(item=>`Dia ${item.world_day}: ${item.summary}`).join(' | ')||'Ainda não há episódios importantes registrados.',
    beliefs:beliefs.map(item=>`${BELIEF_LABELS[item.topic as BeliefTopic]??item.topic}: ${Number(item.stance)>20?'acredita':Number(item.stance)<-20?'duvida':'ainda não decidiu'} (${item.stance}/100)${item.reason?` — ${item.reason}`:''}`).join(' | '),
    discoveries:explorations.map(item=>`${item.site_id}: ${item.discovery}`).join(' | '),
  };
}
