import { GOODS, MARKET, goodById } from '@theote/npcs/commerce';
import { db } from './database';
import { getWorldClock } from './clock';
import { broadcast } from './realtime';

function quantity(value:unknown) {
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<1||number>10)throw new Error('Quantidade inválida (1 a 10).');
  return number;
}

export async function buyItem(npcId:string,itemId:unknown,amount:unknown) {
  const good=goodById(itemId),count=quantity(amount);
  if(!good)throw new Error('Produto não encontrado.');
  const {day}=await getWorldClock();
  const balance=await db.begin(async tx=>{
    const [npc]=await tx`SELECT name,x,z,coins,mode FROM npc_state WHERE id=${npcId} FOR UPDATE`;
    if(!npc||npc.mode==='departed')throw new Error('Morador indisponível.');
    if(Math.hypot(npc.x-MARKET.x,npc.z-MARKET.z)>2)throw new Error('É preciso estar junto à banca para comprar.');
    if(Number(npc.coins)<good.price*count)throw new Error('Moedas insuficientes.');
    const [updated]=await tx`UPDATE npc_state SET coins=coins-${good.price*count},updated_at=now() WHERE id=${npcId} RETURNING coins`;
    await tx`INSERT INTO npc_inventory(npc_id,item_id,quantity) VALUES (${npcId},${good.id},${count}) ON CONFLICT (npc_id,item_id) DO UPDATE SET quantity=npc_inventory.quantity+${count}`;
    await tx`INSERT INTO npc_item_events(npc_id,item_id,kind,world_day) VALUES (${npcId},${good.id},'bought',${day})`;
    return updated.coins;
  });
  broadcast('inventory_changed',{npcId});
  return `Comprou ${count} ${good.name} por ${good.price*count} moeda(s). Saldo: ${balance}.`;
}

export async function consumeItem(npcId:string,itemId:unknown) {
  const good=goodById(itemId);
  if(!good)throw new Error('Produto não encontrado.');
  const {day}=await getWorldClock();
  const need=good.kind==='food'?'hunger':'thirst';
  const remaining=await db.begin(async tx=>{
    const [npc]=await tx`SELECT mode,hunger,thirst FROM npc_state WHERE id=${npcId} FOR UPDATE`;
    if(!npc||npc.mode==='departed')throw new Error('Morador indisponível.');
    const [stock]=await tx`UPDATE npc_inventory SET quantity=quantity-1 WHERE npc_id=${npcId} AND item_id=${good.id} AND quantity>0 RETURNING quantity`;
    if(!stock)throw new Error(`${good.name} não está no inventário.`);
    const before=Number(npc[need]),after=Math.max(0,before-good.relief);
    if(need==='hunger')await tx`UPDATE npc_state SET hunger=${after},updated_at=now() WHERE id=${npcId}`;
    else await tx`UPDATE npc_state SET thirst=${after},updated_at=now() WHERE id=${npcId}`;
    if(good.joy>0){
      await tx`UPDATE npc_affect SET mood='joy',valence=LEAST(100,valence+${good.joy}),pressure=GREATEST(0,pressure-3),updated_at=now() WHERE npc_id=${npcId}`;
      await tx`INSERT INTO npc_feeling_events(npc_id,world_day,emotion,intensity,cause) VALUES (${npcId},${day},'joy',2,${`Gostou de consumir ${good.name}.`})`;
      await tx`UPDATE npc_state SET emotion='happy',updated_at=now() WHERE id=${npcId}`;
    }
    await tx`INSERT INTO npc_item_events(npc_id,item_id,kind,world_day,need_before,need_after,joy_gain) VALUES (${npcId},${good.id},'consumed',${day},${before},${after},${good.joy})`;
    await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${npcId},'food',${good.id},${`${good.name} reduziu minha ${need==='hunger'?'fome':'sede'} de ${before.toFixed(2)}% para ${after.toFixed(2)}%${good.joy?` e me trouxe alegria (+${good.joy})`:''}.`},2,${day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary`;
    return stock.quantity;
  });
  broadcast('inventory_changed',{npcId});
  return `${good.kind==='food'?'Comeu':'Bebeu'} ${good.name}; ${good.kind==='food'?'fome':'sede'} diminuiu em até ${good.relief}%${good.joy?` e ganhou ${good.joy} de alegria`:''}. ${remaining} restante(s).`;
}

export async function donateItem(fromId:string,toId:string,itemId:unknown,amount:unknown) {
  const good=goodById(itemId),count=quantity(amount);
  if(!good||fromId===toId)throw new Error('Doação inválida.');
  const {day}=await getWorldClock();
  const names=await db.begin(async tx=>{
    const people=await tx`SELECT id,name,x,z,mode FROM npc_state WHERE id IN (${fromId},${toId}) ORDER BY id FOR UPDATE`;
    const sender=people.find(person=>person.id===fromId),receiver=people.find(person=>person.id===toId);
    if(!sender||!receiver||sender.mode==='departed'||receiver.mode==='departed')throw new Error('Morador indisponível.');
    if(Math.hypot(sender.x-receiver.x,sender.z-receiver.z)>2)throw new Error('É preciso estar a até dois metros para doar.');
    const [stock]=await tx`UPDATE npc_inventory SET quantity=quantity-${count} WHERE npc_id=${fromId} AND item_id=${good.id} AND quantity>=${count} RETURNING quantity`;
    if(!stock)throw new Error('Itens insuficientes no inventário.');
    await tx`INSERT INTO npc_inventory(npc_id,item_id,quantity) VALUES (${toId},${good.id},${count}) ON CONFLICT (npc_id,item_id) DO UPDATE SET quantity=npc_inventory.quantity+${count}`;
    await tx`INSERT INTO npc_item_events(npc_id,other_id,item_id,kind,world_day) VALUES (${fromId},${toId},${good.id},'given',${day}),(${toId},${fromId},${good.id},'received',${day})`;
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${toId},${`${sender.name} doou ${count} ${good.name} a você.`})`;
    await tx`UPDATE npc_state SET next_thought_at=NULL WHERE id=${toId}`;
    return {sender:sender.name,receiver:receiver.name};
  });
  broadcast('inventory_changed',{npcId:fromId});broadcast('inventory_changed',{npcId:toId});
  return `${names.sender} doou ${count} ${good.name} a ${names.receiver}.`;
}

export async function leaveWorld(npcId:string) {
  const {day}=await getWorldClock();
  const name=await db.begin(async tx=>{
    const [npc]=await tx`SELECT name,coins,mode FROM npc_state WHERE id=${npcId} FOR UPDATE`;
    if(!npc||npc.mode==='departed')throw new Error('Morador indisponível.');
    if(Number(npc.coins)<1000)throw new Error('São necessárias 1000 moedas para visitar o mundo exterior.');
    await tx`UPDATE npc_state SET coins=coins-1000,mode='departed',departed_at=now(),goal_x=NULL,goal_z=NULL,goal_person_id=NULL,next_thought_at=NULL,updated_at=now() WHERE id=${npcId}`;
    await tx`INSERT INTO npc_coin_events(npc_id,kind,amount,world_day,balance_after) VALUES (${npcId},'spent',1000,${day},${Number(npc.coins)-1000})`;
    await tx`INSERT INTO npc_notifications(npc_id,message) SELECT id,${`${npc.name} juntou 1000 moedas e deixou o vale para conhecer o mundo exterior. Apenas essa pessoa saiu.`} FROM npc_state WHERE id<>${npcId} AND mode<>'departed'`;
    await tx`UPDATE npc_state SET next_thought_at=NULL WHERE id<>${npcId} AND mode<>'departed'`;
    return npc.name as string;
  });
  broadcast('departure',{npcId,name,day});
  return `${name} saiu do vale para conhecer o mundo exterior. Todos foram avisados.`;
}

export { GOODS, MARKET };
