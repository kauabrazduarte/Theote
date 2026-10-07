import { db } from './database';
import { broadcast } from './realtime';

export async function recordSocialInteraction(npcId:string,otherId:string,worldDay:number,sourceType:'dialogue'|'unanswered',sourceId:number) {
  const event=await db.begin(async tx=>{
    const claimed=await tx`INSERT INTO npc_social_interactions(npc_id,source_type,source_id) VALUES (${npcId},${sourceType},${sourceId}) ON CONFLICT DO NOTHING RETURNING npc_id`;
    if(!claimed.length)return null;
    const [state]=await tx`UPDATE npc_state SET interaction_progress=(interaction_progress+1)%20,coins=coins+CASE WHEN interaction_progress=19 THEN 1 ELSE 0 END,updated_at=now() WHERE id=${npcId} RETURNING interaction_progress,coins`;
    if(Number(state.interaction_progress)!==0)return null;
    const [entry]=await tx`INSERT INTO npc_coin_events(npc_id,other_id,kind,amount,world_day,balance_after) VALUES (${npcId},${otherId},'earned',1,${worldDay},${state.coins}) RETURNING id,created_at`;
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${npcId},${`Você recebeu uma moeda. Agora tem ${state.coins} moeda(s). Você não sabe por que ela apareceu.`})`;
    return entry;
  });
  if(event)broadcast('coin_event',{id:Number(event.id),npcId,otherId,kind:'earned',amount:1,at:event.created_at});
}

export async function giveCoin(fromId:string,toId:string,amount:number,worldDay:number) {
  if(!Number.isSafeInteger(amount)||amount<1||amount>1000||fromId===toId)throw new Error('Quantidade de moedas inválida.');
  const result=await db.begin(async tx=>{
    const people=await tx`SELECT id,name,x,z,coins,mode FROM npc_state WHERE id IN (${fromId},${toId}) ORDER BY id FOR UPDATE`;
    const sender=people.find(person=>person.id===fromId),receiver=people.find(person=>person.id===toId);
    if(!sender||!receiver)throw new Error('Morador não encontrado.');
    if(sender.mode==='departed'||receiver.mode==='departed')throw new Error('Morador indisponível.');
    if(Math.hypot(sender.x-receiver.x,sender.z-receiver.z)>2)throw new Error('É preciso estar a até dois metros para entregar moedas.');
    if(Number(sender.coins)<amount)throw new Error('Moedas insuficientes.');
    const [debit]=await tx`UPDATE npc_state SET coins=coins-${amount},updated_at=now() WHERE id=${fromId} RETURNING coins`;
    const [credit]=await tx`UPDATE npc_state SET coins=coins+${amount},next_thought_at=NULL,updated_at=now() WHERE id=${toId} RETURNING coins`;
    const [given]=await tx`INSERT INTO npc_coin_events(npc_id,other_id,kind,amount,world_day,balance_after) VALUES (${fromId},${toId},'given',${amount},${worldDay},${debit.coins}) RETURNING id,created_at`;
    const [received]=await tx`INSERT INTO npc_coin_events(npc_id,other_id,kind,amount,world_day,balance_after) VALUES (${toId},${fromId},'received',${amount},${worldDay},${credit.coins}) RETURNING id,created_at`;
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${toId},${`${sender.name} deu ${amount} moeda(s) a você. Seu saldo agora é ${credit.coins}.`})`;
    return {sender,receiver,given,received,senderBalance:debit.coins,receiverBalance:credit.coins};
  });
  broadcast('coin_event',{id:Number(result.given.id),npcId:fromId,otherId:toId,kind:'given',amount,at:result.given.created_at});
  broadcast('coin_event',{id:Number(result.received.id),npcId:toId,otherId:fromId,kind:'received',amount,at:result.received.created_at});
  return `${result.sender.name} entregou ${amount} moeda(s) a ${result.receiver.name}. Restam ${result.senderBalance} moeda(s).`;
}
