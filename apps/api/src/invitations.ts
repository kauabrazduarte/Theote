import landmarks from '../../../packages/npcs/data/landmarks.json';
import { db } from './database';
import { getWorldClock } from './clock';
import { broadcast } from './realtime';
import { interruptThought } from './agents';
import { isWalkable } from '@theote/npcs/navigation';

export async function listInvitations(npcId?:string) {
  const rows=npcId?await db`SELECT i.*,h.name AS host_name FROM conversation_invitations i JOIN npc_state h ON h.id=i.host_id WHERE EXISTS(SELECT 1 FROM conversation_invitees p WHERE p.invitation_id=i.id AND p.npc_id=${npcId}) ORDER BY i.id DESC LIMIT 100`:await db`SELECT i.*,h.name AS host_name FROM conversation_invitations i JOIN npc_state h ON h.id=i.host_id ORDER BY i.id DESC LIMIT 100`;
  const ids=rows.map(row=>row.id);
  const people=ids.length?await db`SELECT p.invitation_id,p.npc_id,n.name,p.response,p.travel_decision,p.attended_at FROM conversation_invitees p JOIN npc_state n ON n.id=p.npc_id WHERE p.invitation_id IN ${db(ids)} ORDER BY n.name`:[];
  return rows.map(row=>({...row,people:people.filter(person=>String(person.invitation_id)===String(row.id))}));
}

export async function createInvitation(hostId:string,inviteeIds:string[],sourceMessageId:number,siteId:string,targetDay:number,targetHour:number,targetMinute:number) {
  const ids=[...new Set(inviteeIds)].filter(id=>id!==hostId);
  if(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0||ids.length<1||ids.length>6)throw new Error('O convite precisa de uma conversa e de ao menos um convidado.');
  const site=landmarks.find(place=>place.id===siteId);
  if(!site||!isWalkable(site.x,site.z))throw new Error('O local do encontro não está acessível.');
  const clock=await getWorldClock();
  const start=clock.day*1440+clock.hour*60+clock.minute,target=targetDay*1440+targetHour*60+targetMinute;
  if(!Number.isInteger(targetDay)||!Number.isInteger(targetHour)||!Number.isInteger(targetMinute)||target-start<15||target-start>1440||targetHour<0||targetHour>23||targetMinute<0||targetMinute>59)throw new Error('Escolha um dia e uma hora futura exata para o convite.');
  const saved=await db.begin(async tx=>{
    const [source]=await tx`SELECT id,participants,created_at FROM dialogue_messages WHERE id=${sourceMessageId}`;
    if(!source||Date.now()-new Date(source.created_at).getTime()>120_000||![hostId,...ids].every(id=>source.participants.includes(id)))throw new Error('Todos os convidados precisam ter participado da conversa recente.');
    const [duplicate]=await tx`SELECT i.id FROM conversation_invitations i JOIN dialogue_messages m ON m.id=i.source_message_id WHERE i.host_id=${hostId} AND m.reply_to_message_id=${sourceMessageId} LIMIT 1`;
    if(duplicate)throw new Error('Essa conversa já recebeu um convite.');
    const people=await tx`SELECT id,name,mode FROM npc_state WHERE id IN ${tx([hostId,...ids])}`;
    if(people.length!==ids.length+1||people.some(person=>person.mode==='departed'))throw new Error('Há uma pessoa indisponível no convite.');
    const host=people.find(person=>person.id===hostId)!;
    const participants=[hostId,...ids].sort();
    const content=`Convite para conversar em ${site.name}, dia ${targetDay}, às ${String(targetHour).padStart(2,'0')}:${String(targetMinute).padStart(2,'0')}. Convidados: ${ids.map(id=>people.find(person=>person.id===id)?.name??id).join(', ')}.`;
    const [message]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id) VALUES (${clock.day},${clock.hour},${clock.minute},${hostId},${ids.length===1?ids[0]:null},${host.name},${content},${tx.json(participants)},${sourceMessageId}) RETURNING id,created_at`;
    const [invitation]=await tx`INSERT INTO conversation_invitations(host_id,source_message_id,site_id,x,z,target_day,target_hour,target_minute) VALUES (${hostId},${message.id},${site.id},${site.x},${site.z},${targetDay},${targetHour},${targetMinute}) RETURNING id`;
    for(const id of participants){
      await tx`INSERT INTO conversation_invitees(invitation_id,npc_id,response,responded_at) VALUES (${invitation.id},${id},${id===hostId?'accepted':'pending'},${id===hostId?new Date():null})`;
      await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${id},'invitation',${String(invitation.id)},${content},3,${clock.day})`;
      if(id!==hostId){await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${id},${`${host.name} convidou você para conversar em ${site.name}, dia ${targetDay}, às ${String(targetHour).padStart(2,'0')}:${String(targetMinute).padStart(2,'0')}. Decida se aceita.`})`;await tx`UPDATE npc_state SET next_thought_at=NULL WHERE id=${id}`;}
    }
    await tx`UPDATE npc_state SET thirst=LEAST(100,thirst+0.0005) WHERE id=${hostId}`;
    return {invitationId:Number(invitation.id),message,content,participants,hostName:host.name};
  });
  broadcast('dialogue',{id:Number(saved.message.id),world_day:clock.day,world_hour:clock.hour,world_minute:clock.minute,from_npc_id:hostId,to_npc_id:ids.length===1?ids[0]:null,participants:saved.participants,speaker_name:saved.hostName,content:saved.content,created_at:saved.message.created_at,reply_to_message_id:sourceMessageId});
  broadcast('invitation_changed',{id:saved.invitationId});
  for(const id of ids)interruptThought(id,'Convite para conversar recebido.');
  return `Registrou o convite #${saved.invitationId}: ${saved.content}`;
}

export async function respondInvitation(npcId:string,invitationId:number,accept:boolean) {
  if(!Number.isSafeInteger(invitationId)||invitationId<=0)throw new Error('Convite inválido.');
  const clock=await getWorldClock();
  const saved=await db.begin(async tx=>{
    const [person]=await tx`UPDATE conversation_invitees SET response=${accept?'accepted':'declined'},responded_at=now() WHERE invitation_id=${invitationId} AND npc_id=${npcId} AND response='pending' RETURNING npc_id`;
    if(!person)throw new Error('Convite já respondido ou não destinado a você.');
    const [invite]=await tx`SELECT i.*,h.name AS host_name FROM conversation_invitations i JOIN npc_state h ON h.id=i.host_id WHERE i.id=${invitationId}`;
    if(Number(invite.target_day)*1440+Number(invite.target_hour)*60+Number(invite.target_minute)<=clock.day*1440+clock.hour*60+clock.minute)throw new Error('O horário do convite já passou.');
    const [npc]=await tx`SELECT name FROM npc_state WHERE id=${npcId}`;
    const participants=(await tx`SELECT npc_id FROM conversation_invitees WHERE invitation_id=${invitationId} ORDER BY npc_id`).map(row=>row.npc_id);
    const content=accept?`Aceito conversar em ${landmarks.find(place=>place.id===invite.site_id)?.name??invite.site_id}, dia ${invite.target_day}, às ${String(invite.target_hour).padStart(2,'0')}:${String(invite.target_minute).padStart(2,'0')}.`:'Não vou ao encontro combinado.';
    const [message]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id) VALUES (${clock.day},${clock.hour},${clock.minute},${npcId},${invite.host_id},${npc.name},${content},${tx.json(participants)},${invite.source_message_id}) RETURNING id,created_at`;
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${invite.host_id},${`${npc.name} ${accept?'aceitou':'recusou'} o convite #${invitationId} para ${invite.site_id}.`})`;
    await tx`UPDATE npc_state SET next_thought_at=NULL WHERE id=${invite.host_id}`;
    await tx`UPDATE npc_memory_events SET summary=${`${npc.name} ${accept?'aceitou':'recusou'} o convite: ${content}`} WHERE npc_id=${npcId} AND kind='invitation' AND subject=${String(invitationId)}`;
    await tx`UPDATE npc_state SET thirst=LEAST(100,thirst+0.0005) WHERE id=${npcId}`;
    return {invite,message,content,participants,name:npc.name};
  });
  broadcast('dialogue',{id:Number(saved.message.id),world_day:clock.day,world_hour:clock.hour,world_minute:clock.minute,from_npc_id:npcId,to_npc_id:saved.invite.host_id,participants:saved.participants,speaker_name:saved.name,content:saved.content,created_at:saved.message.created_at,reply_to_message_id:Number(saved.invite.source_message_id)});
  broadcast('invitation_changed',{id:invitationId});
  interruptThought(saved.invite.host_id,'Resposta ao convite recebida.');
  return `${accept?'Aceitou':'Recusou'} o convite #${invitationId}.`;
}

export async function decideTravel(npcId:string,invitationId:number,go:boolean) {
  const clock=await getWorldClock();
  const outcome=await db.begin(async tx=>{
    const [invite]=await tx`SELECT i.*,p.response,p.travel_decision FROM conversation_invitations i JOIN conversation_invitees p ON p.invitation_id=i.id WHERE i.id=${invitationId} AND p.npc_id=${npcId} FOR UPDATE OF p`;
    if(!invite||invite.response!=='accepted'||invite.travel_decision)throw new Error('Não há decisão de deslocamento pendente.');
    const now=clock.day*1440+clock.hour*60+clock.minute,target=Number(invite.target_day)*1440+Number(invite.target_hour)*60+Number(invite.target_minute);
    if(target-now>15||now-target>10)throw new Error('Ainda não chegou a hora desse encontro.');
    await tx`UPDATE conversation_invitees SET travel_decision=${go?'going':'skipping'} WHERE invitation_id=${invitationId} AND npc_id=${npcId}`;
    if(go){
      const [npc]=await tx`SELECT x,z,mode FROM npc_state WHERE id=${npcId} FOR UPDATE`;
      if(!npc||npc.mode==='departed')throw new Error('Morador indisponível.');
      if(Math.hypot(npc.x-invite.x,npc.z-invite.z)>1.8)await tx`UPDATE npc_state SET goal_x=${invite.x},goal_z=${invite.z},goal_person_id=NULL,mode='walking',sleep_on_arrival=false,next_thought_at=NULL WHERE id=${npcId}`;
    }
    await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${npcId},'invitation_decision',${String(invitationId)},${go?`Decidi ir ao encontro #${invitationId}.`:`Decidi não ir ao encontro #${invitationId}.`},3,${clock.day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary`;
    return go?`Decidiu ir ao encontro #${invitationId} no local e hora combinados.`:`Decidiu não ir ao encontro #${invitationId}.`;
  });
  broadcast('invitation_changed',{id:invitationId});
  return outcome;
}

export async function updateInvitations() {
  const clock=await getWorldClock();
  const now=clock.day*1440+clock.hour*60+clock.minute;
  const due=await db`SELECT i.id,i.target_day,i.target_hour,i.target_minute,p.npc_id FROM conversation_invitations i JOIN conversation_invitees p ON p.invitation_id=i.id WHERE p.response='accepted' AND p.travel_decision IS NULL AND p.reminded_at IS NULL AND i.target_day*1440+i.target_hour*60+i.target_minute-${now} BETWEEN 0 AND 15`;
  for(const item of due){
    const [claimed]=await db`UPDATE conversation_invitees SET reminded_at=now() WHERE invitation_id=${item.id} AND npc_id=${item.npc_id} AND reminded_at IS NULL RETURNING npc_id`;
    if(!claimed)continue;
    await db`INSERT INTO npc_notifications(npc_id,message) VALUES (${item.npc_id},${`O encontro #${item.id} começa no dia ${item.target_day}, às ${String(item.target_hour).padStart(2,'0')}:${String(item.target_minute).padStart(2,'0')}. Decida agora se irá ao local combinado.`})`;
    await db`UPDATE npc_state SET next_thought_at=NULL WHERE id=${item.npc_id}`;
    interruptThought(item.npc_id,'Hora de decidir sobre um encontro.');
  }
  const attended=await db`UPDATE conversation_invitees p SET attended_at=now() FROM conversation_invitations i,npc_state n WHERE p.invitation_id=i.id AND p.npc_id=n.id AND p.response='accepted' AND p.travel_decision='going' AND p.attended_at IS NULL AND ${now} BETWEEN i.target_day*1440+i.target_hour*60+i.target_minute AND i.target_day*1440+i.target_hour*60+i.target_minute+15 AND sqrt(power(n.x-i.x,2)+power(n.z-i.z,2))<=2 RETURNING p.invitation_id,p.npc_id`;
  for(const item of attended)broadcast('invitation_changed',{id:Number(item.invitation_id),npcId:item.npc_id});
}
