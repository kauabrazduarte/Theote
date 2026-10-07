import { EXPLORE_SITES } from '@theote/npcs/worldLayout';
import { db } from './database';
import { getWorldClock } from './clock';

export async function exploreSite(npcId:string,siteId:unknown) {
  const site=EXPLORE_SITES.find(item=>item.id===siteId);
  if(!site)throw new Error('Esse lugar não oferece uma descoberta.');
  const {day}=await getWorldClock();
  return db.begin(async tx=>{
    const [npc]=await tx`SELECT x,z,mode FROM npc_state WHERE id=${npcId} FOR UPDATE`;
    if(!npc||npc.mode==='departed'||Math.hypot(npc.x-site.x,npc.z-site.z)>2.2)throw new Error('É preciso chegar ao local antes de explorá-lo.');
    const [found]=await tx`INSERT INTO npc_explorations(npc_id,site_id,discovery,world_day) VALUES (${npcId},${site.id},${site.discovery},${day}) ON CONFLICT DO NOTHING RETURNING site_id`;
    if(!found)throw new Error('Já conhece essa descoberta.');
    await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${npcId},'discovery',${site.id},${`Em ${site.name}, descobri: ${site.discovery}`},4,${day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary`;
    await tx`UPDATE npc_affect SET mood='curiosity',valence=LEAST(100,valence+3),updated_at=now() WHERE npc_id=${npcId}`;
    await tx`INSERT INTO npc_feeling_events(npc_id,world_day,emotion,intensity,cause) VALUES (${npcId},${day},'curiosity',2,${`Explorou ${site.name}.`})`;
    return `Explorou ${site.name}. ${site.discovery}`;
  });
}
