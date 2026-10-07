import profiles from '@theote/npcs/data/characters.json';
import { db, initializeDatabase } from './database';
import { elapsedSecondsForWorldTime } from '@theote/npcs/worldClock';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi configurada.');
await initializeDatabase();
await db.begin(async tx => {
  await tx`TRUNCATE ai_cost_reservations,conversation_invitees,conversation_invitations,npc_beliefs,npc_explorations,npc_memory_events,npc_agreements,npc_item_events,npc_inventory,npc_social_interactions,npc_coin_events,npc_conversation_waits,npc_proximity,npc_notifications,npc_feeling_events,npc_decisions,dialogue_messages RESTART IDENTITY CASCADE`;
  await tx`UPDATE npc_memories SET summary='Se eu juntar 1000 moedas, posso pagar para conhecer o mundo exterior. Só eu saio se decidir ir; todos no vale receberão a notícia. A banca do vale vende comida e bebida; posso consumir ou doar o que tenho.',summarized_through_dialogue_id=0,last_summarized_day=0,updated_at=now()`;
  await tx`UPDATE npc_affect SET mood='neutral',pressure=0,valence=0,updated_at=now()`;
  await tx`UPDATE npc_bonds SET warmth=0,trust=40,tension=0,updated_at=now()`;
  for (const profile of profiles) {
    const [x,,z] = profile.position;
    await tx`UPDATE npc_state SET x=${x},z=${z},goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',departed_at=NULL,sleep_on_arrival=false,emotion='neutral',stamina=100,hunger=0,thirst=0,coins=0,interaction_progress=0,last_stamina_at=now(),last_decision_at=NULL,next_thought_at=NULL,planned_wake_at=NULL,last_wake_day=1,updated_at=now() WHERE id=${profile.id}`;
    await tx`INSERT INTO npc_inventory(npc_id,item_id,quantity) VALUES (${profile.id},'apple',1),(${profile.id},'water',1)`;
    for(const topic of ['walls','cesar','outside'])await tx`INSERT INTO npc_beliefs(npc_id,topic) VALUES (${profile.id},${topic})`;
    for (const other of profiles) if (profile.id !== other.id && profile.relationships[other.id]) {
      await tx`UPDATE npc_bonds SET warmth=45,trust=65 WHERE npc_id=${profile.id} AND other_id=${other.id}`;
    }
  }
  const startOffset=elapsedSecondsForWorldTime(1,9);
  await tx`UPDATE world_state SET started_at=now()-(${startOffset}*interval '1 second'),last_summary_day=0,meeting_day=0,next_npc_index=0,usage_report_started_at=now(),updated_at=now() WHERE id=1`;
});
await db.end();
console.info('Theote reiniciado: 01/01/05 A.G., 09:00, quatro moradores acordados. O histórico real de custos foi preservado para o limite mensal.');
