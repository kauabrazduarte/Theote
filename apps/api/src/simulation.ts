import { db } from './database';
import { getWorldClock } from './clock';
import { interruptThought, makeDecision, schedulerReady, summarizeClosedDays } from './agents';
import { configuredInterval } from './openrouter';
import { broadcast } from './realtime';
import houses from '@theote/npcs/data/houses.json';
import { CardialService } from './cardial';
import { elapsedSecondsForWorldTime, worldHoursAtElapsed } from '@theote/npcs/worldClock';
import { advanceOnRoute, isWalkable, segmentWalkable } from '@theote/npcs/navigation';
import { updateInvitations } from './invitations';

type MovingNpc={id:string;name:string;profile:any;x:number;z:number;goal_x:number|null;goal_z:number|null;goal_person_id:string|null;mode:string;sleep_on_arrival:boolean;stamina:number;hunger:number;thirst:number;last_stamina_at:Date;last_wake_day:number;planned_wake_at:Date|null;next_thought_at:Date|null;version:string};
const home=Object.fromEntries(houses.map(house=>[house.id,house.entrance])) as Record<string,[number,number]>;
let busy=false;

export async function updateSimulation() {
  if(busy)return;busy=true;
  try {
    const {day,hour,minute,elapsedSeconds:worldElapsed}=await getWorldClock();
    const rows=await db<MovingNpc[]>`SELECT *,xmin::text AS version FROM npc_state WHERE mode<>'departed' ORDER BY id`;
    const mutualTargets=new Set(rows.flatMap(person=>rows.filter(other=>person.id<other.id&&person.mode==='walking'&&other.mode==='walking'&&person.goal_person_id===other.id&&other.goal_person_id===person.id).map(other=>`${person.id}:${other.id}`)));
    const now=Date.now();
    for(const npc of rows) {
      const scheduledWake=hour>=9&&Number(npc.last_wake_day)<day;
      const plannedWake=npc.planned_wake_at&&new Date(npc.planned_wake_at).getTime()<=now;
      if((scheduledWake&&(npc.mode==='sleeping'||npc.sleep_on_arrival))||(plannedWake&&npc.mode==='sleeping')) {
        const [homeX,homeZ]=home[npc.profile.home]??[0,0];
        // The fixed morning routine overrides sleep and exhaustion, then gives them
        // enough stamina to remain awake after getting up.
        await db`UPDATE npc_state SET x=${homeX},z=${homeZ+1.4},goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',sleep_on_arrival=false,next_thought_at=NULL,planned_wake_at=NULL,stamina=100,last_wake_day=${day},last_stamina_at=now(),updated_at=now() WHERE id=${npc.id}`;
        continue;
      }
      if(npc.mode==='resting'&&npc.next_thought_at&&new Date(npc.next_thought_at).getTime()<=now) {
        const resumed=await db`UPDATE npc_state SET mode='wandering',next_thought_at=NULL,updated_at=now() WHERE id=${npc.id} AND mode='resting' AND next_thought_at<=now() RETURNING id`;
        if(resumed.length)broadcast('agent_event',{npcId:npc.id,npcName:npc.name,stage:'rest',status:'completed',outcome:'Terminou a pausa e pode agir novamente.',at:new Date().toISOString()});
        continue;
      }
      const realDelta=Math.min(5,Math.max(0,(now-new Date(npc.last_stamina_at).getTime())/1000));
      const elapsedWorldHours=worldHoursAtElapsed(worldElapsed)-worldHoursAtElapsed(Math.max(0,worldElapsed-realDelta));
      let stamina=Math.max(0,Math.min(100,npc.stamina+(npc.mode==='sleeping'?elapsedWorldHours*12.5:-elapsedWorldHours*(100/48))));
      let x=npc.x,z=npc.z,mode=npc.mode,goalX=npc.goal_x,goalZ=npc.goal_z,follow=npc.goal_person_id,sleepOnArrival=npc.sleep_on_arrival;
      if(stamina<=0&&mode!=='sleeping') {
        [goalX,goalZ]=npc.profile.bedPosition??home[npc.profile.home]??[0,0];mode='walking';follow=null;sleepOnArrival=true;
        const wakeAt=elapsedSecondsForWorldTime(day+(hour>=9?1:0),9);
        await db`UPDATE npc_state SET next_thought_at=NULL,planned_wake_at=COALESCE(planned_wake_at,now()+(${Math.max(1,wakeAt-worldElapsed)}*interval '1 second')) WHERE id=${npc.id}`;
      }
      if(mode==='following'&&follow) {
        const person=rows.find(other=>other.id===follow);
        if(person){goalX=person.x+0.8;goalZ=person.z;}else{mode='wandering';follow=null;goalX=null;goalZ=null;}
      }
      if(mode==='walking'&&follow) {
        const person=rows.find(other=>other.id===follow);
        if(person){goalX=person.x;goalZ=person.z;}
        else{mode='wandering';follow=null;goalX=null;goalZ=null;}
      }
      if((mode==='walking'||mode==='following')&&goalX!==null&&goalZ!==null) {
        const target=mode==='walking'&&follow?rows.find(other=>other.id===follow):undefined;
        const nearPerson=target&&Math.hypot(target.x-x,target.z-z)<=1.8&&segmentWalkable({x,z},{x:target.x,z:target.z});
        if(!nearPerson) {
          const next=advanceOnRoute({x,z},{x:goalX,z:goalZ},0.85*realDelta);
          const tooClose=rows.some(other=>other.id!==npc.id&&other.mode!=='sleeping'&&Math.hypot(next.x-other.x,next.z-other.z)<0.6);
          if(!tooClose){x=next.x;z=next.z;}
          else {
            const dx=goalX-x,dz=goalZ-z,length=Math.max(0.001,Math.hypot(dx,dz));
            for(const sign of [-1,1]) {
              const side={x:x+sign*dz/length*0.5,z:z-sign*dx/length*0.5};
              if(isWalkable(side.x,side.z)&&segmentWalkable({x,z},side)&&rows.every(other=>other.id===npc.id||Math.hypot(side.x-other.x,side.z-other.z)>=0.6)){x=side.x;z=side.z;break;}
            }
          }
        }
        const arrived=nearPerson||mode!=='following'&&Math.hypot(goalX-x,goalZ-z)<=0.18;
        if(arrived&&mode!=='following'){goalX=null;goalZ=null;follow=null;mode=sleepOnArrival?'sleeping':'wandering';sleepOnArrival=false;}
      }
      const walked=Math.hypot(x-npc.x,z-npc.z);
      const hunger=Math.min(100,npc.hunger+elapsedWorldHours*4+walked*0.0005);
      const thirst=Math.min(100,npc.thirst+elapsedWorldHours*6+walked*0.005);
      const arrived=npc.mode==='walking'&&mode==='wandering'&&goalX===null;
      const changed=await db`UPDATE npc_state SET x=${x},z=${z},mode=${mode},goal_x=${goalX},goal_z=${goalZ},goal_person_id=${follow},sleep_on_arrival=${sleepOnArrival},stamina=${stamina},hunger=${hunger},thirst=${thirst},next_thought_at=CASE WHEN ${arrived} THEN NULL ELSE next_thought_at END,last_wake_day=${scheduledWake?day:npc.last_wake_day},last_stamina_at=now(),updated_at=now() WHERE id=${npc.id} AND xmin::text=${npc.version} RETURNING id`;
      if(changed.length&&(npc.mode==='walking'||npc.mode==='following')&&(mode==='wandering'||mode==='sleeping')&&goalX===null)broadcast('agent_event',{npcId:npc.id,npcName:npc.name,stage:'movement',status:'completed',outcome:mode==='sleeping'?'Chegou à cama e foi dormir.':'Chegou ao destino.',at:new Date().toISOString()});
    }
    const positions=await db<MovingNpc[]>`SELECT * FROM npc_state WHERE mode<>'departed' ORDER BY id`;
    const currentPairs=new Set<string>();
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++) {
      const a=positions[i],b=positions[j],key=`${a.id}:${b.id}`;
      if(Math.hypot(a.x-b.x,a.z-b.z)>2)continue;
      currentPairs.add(key);
      if(mutualTargets.has(key)) {
        await db.begin(async tx=>{
          for(const person of [a,b]) {
            await tx`UPDATE npc_state SET goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',next_thought_at=NULL,updated_at=now() WHERE id=${person.id} AND mode='walking'`;
            await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${person.id},${`Você encontrou ${person.id===a.id?b.name:a.name} no meio do caminho. Vocês pararam frente a frente.`})`;
          }
        });
        interruptThought(a.id);interruptThought(b.id);
        broadcast('agent_event',{npcId:a.id,npcName:a.name,stage:'movement',status:'completed',outcome:`Encontrou ${b.name} no meio do caminho e parou.`,at:new Date().toISOString()});
        broadcast('agent_event',{npcId:b.id,npcName:b.name,stage:'movement',status:'completed',outcome:`Encontrou ${a.name} no meio do caminho e parou.`,at:new Date().toISOString()});
      }
      const [prior]=await db`SELECT 1 FROM npc_proximity WHERE npc_a=${a.id} AND npc_b=${b.id}`;
      if(!prior) {
        await db`INSERT INTO npc_proximity(npc_a,npc_b) VALUES (${a.id},${b.id}) ON CONFLICT DO NOTHING`;
        await db`INSERT INTO npc_notifications(npc_id,message) VALUES (${a.id},${`${b.name} chegou perto de você. Interrompa o que estiver fazendo e perceba a presença dela/dele.`}),(${b.id},${`${a.name} chegou perto de você. Interrompa o que estiver fazendo e perceba a presença dela/dele.`})`;
        interruptThought(a.id);interruptThought(b.id);
        broadcast('agent_event',{npcId:a.id,npcName:a.name,stage:'arrival',status:'started',outcome:`${b.name} chegou perto.`,at:new Date().toISOString()});
        broadcast('agent_event',{npcId:b.id,npcName:b.name,stage:'arrival',status:'started',outcome:`${a.name} chegou perto.`,at:new Date().toISOString()});
      }
    }
    const oldPairs=await db`SELECT npc_a,npc_b FROM npc_proximity`;
    for(const pair of oldPairs)if(!currentPairs.has(`${pair.npc_a}:${pair.npc_b}`))await db`DELETE FROM npc_proximity WHERE npc_a=${pair.npc_a} AND npc_b=${pair.npc_b}`;
    const dueConversations=await db`SELECT w.message_id,w.sender_id,w.recipient_id,s.name AS sender_name,r.name AS recipient_name,m.participants FROM npc_conversation_waits w JOIN npc_state s ON s.id=w.sender_id JOIN npc_state r ON r.id=w.recipient_id JOIN dialogue_messages m ON m.id=w.message_id WHERE w.deadline_at<=now() AND w.notified_at IS NULL AND w.resolved_at IS NULL`;
    for(const wait of dueConversations) {
      const [reply]=await db`SELECT id FROM dialogue_messages WHERE id>${wait.message_id} AND from_npc_id<>${wait.sender_id} AND participants @> ${db.json([wait.sender_id])} AND ${db.json(wait.participants)} @> jsonb_build_array(from_npc_id) AND (reply_to_message_id IS NULL OR reply_to_message_id=${wait.message_id}) LIMIT 1`;
      if(reply) { await db`UPDATE npc_conversation_waits SET resolved_at=now() WHERE message_id=${wait.message_id} AND resolved_at IS NULL`; continue; }
      const [claimed]=await db`UPDATE npc_conversation_waits SET notified_at=now() WHERE message_id=${wait.message_id} AND notified_at IS NULL AND resolved_at IS NULL RETURNING message_id`;
      if(!claimed)continue;
      await new CardialService(wait.sender_id).recordUnanswered(wait.recipient_id,day,Number(wait.message_id));
      const audience=wait.participants.length>=3?'o grupo':wait.recipient_name;
      await db`INSERT INTO npc_notifications(npc_id,message) VALUES (${wait.sender_id},${`Já se passaram 30 segundos desde que você falou com ${audience}, e ainda não houve resposta. Decida se quer esperar mais, tentar falar outra vez ou ir fazer outra coisa.`})`;
      await db`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${wait.sender_id}`;
      interruptThought(wait.sender_id);
      broadcast('agent_event',{npcId:wait.sender_id,npcName:wait.sender_name,stage:'conversation_wait',status:'started',outcome:`Já faz 30 segundos que ${wait.recipient_name} não respondeu.`,at:new Date().toISOString()});
    }
    if(hour===12&&minute<15) {
      const people=await db.begin(async tx=>{
        const claimed=await tx`UPDATE world_state SET meeting_day=${day},updated_at=now() WHERE id=1 AND meeting_day<${day} RETURNING id`;
        if(!claimed.length)return [];
        const participants=await tx`SELECT id,name FROM npc_state WHERE mode<>'departed' ORDER BY id FOR UPDATE`;
        for(let i=0;i<participants.length;i++){
          const person=participants[i],x=(i-(participants.length-1)/2)*0.7;
          await tx`UPDATE npc_state SET x=${x},z=0,goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',sleep_on_arrival=false,next_thought_at=NULL,updated_at=now() WHERE id=${person.id}`;
          await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${person.id},'A reunião das 12:00 começou no largo. Fique na roda e converse com os outros até 12:15.')`;
        }
        return participants;
      });
      if(people.length){
        for(const person of people)interruptThought(person.id);
        broadcast('agent_event',{npcId:'world',npcName:'O mundo',stage:'meeting',status:'started',outcome:'A reunião diária começou no largo. Os moradores conversam até 12:15.',at:new Date().toISOString()});
      }
    }
    await updateInvitations();
  } finally {busy=false;}
}

export async function startScheduler() {
  const lock=await db.reserve();
  const [{locked}]=await lock`SELECT pg_try_advisory_lock(480018) AS locked`;
  if(!locked){lock.release();console.info('[Theote] Outro processo já está executando os ciclos dos moradores.');return()=>{};}
  console.info(`[Theote] Ciclo de mundo iniciado. IA ${schedulerReady()?'habilitada':'pausada até configurar chave e orçamento'}.`);
  const movement=setInterval(()=>void updateSimulation().catch(error=>console.error('[Theote] simulação:',error)),1000);
  let timeout:ReturnType<typeof setTimeout>;
  let stopped=false;
  const nextDecision=async()=>{
    if(stopped)return;
    if(schedulerReady()) {
      try {
        await summarizeClosedDays();
        const [person]=await db`SELECT n.id FROM npc_state n
          WHERE n.mode NOT IN ('sleeping','departed') AND (
            (n.mode IN ('wandering','resting','waiting') AND (n.next_thought_at IS NULL OR n.next_thought_at<=now()))
            OR EXISTS (SELECT 1 FROM npc_notifications p WHERE p.npc_id=n.id AND p.delivered_at IS NULL)
          )
          ORDER BY CASE
            WHEN EXISTS (SELECT 1 FROM npc_notifications p WHERE p.npc_id=n.id AND p.delivered_at IS NULL) THEN 0
            WHEN n.last_decision_at IS NULL OR n.last_decision_at<now()-interval '15 seconds' THEN 1
            ELSE 2 END,
            n.last_decision_at ASC NULLS FIRST LIMIT 1`;
        if(person)await makeDecision(person.id);
      } catch(error) { console.error('[Theote] ciclo de decisão:',error instanceof Error?error.message:'erro desconhecido'); }
    }
    const {min,max}=configuredInterval;
    const regularDelay=min+Math.random()*(max-min);
    const [nextWake]=await db`SELECT EXTRACT(EPOCH FROM (MIN(next_thought_at)-now()))::float8 AS seconds FROM npc_state WHERE next_thought_at>now()`;
    const [{pending}]=await db`SELECT EXISTS(SELECT 1 FROM npc_notifications p JOIN npc_state n ON n.id=p.npc_id WHERE p.delivered_at IS NULL AND n.mode NOT IN ('sleeping','departed')) AS pending`;
    const wakeDelay=Number(nextWake?.seconds);
    timeout=setTimeout(nextDecision,pending?100:Number.isFinite(wakeDelay)?Math.max(250,Math.min(regularDelay,wakeDelay*1000)):regularDelay);
  };
  void updateSimulation();void nextDecision();
  return()=>{stopped=true;clearInterval(movement);clearTimeout(timeout);void lock`SELECT pg_advisory_unlock(480018)`;lock.release();};
}
