-- Requested one-time world reset. Keep model_usage so the monthly budget remains accurate.
TRUNCATE ai_cost_reservations,conversation_invitees,conversation_invitations,npc_beliefs,npc_explorations,npc_memory_events,npc_agreements,npc_item_events,npc_inventory,npc_social_interactions,npc_coin_events,npc_conversation_waits,npc_proximity,npc_notifications,npc_feeling_events,npc_decisions,goblin_torments,dialogue_messages RESTART IDENTITY CASCADE;

UPDATE npc_memories SET summary='Se eu juntar 1000 moedas, posso pagar para conhecer o mundo exterior. Só eu saio se decidir ir; todos no vale receberão a notícia. A banca do vale vende comida e bebida; posso consumir ou doar o que tenho.',summarized_through_dialogue_id=0,last_summarized_day=0,updated_at=now();
UPDATE npc_affect SET mood='neutral',pressure=0,valence=0,updated_at=now();
UPDATE npc_bonds AS b SET warmth=CASE WHEN n.profile->'relationships' ? b.other_id THEN 45 ELSE 0 END,
  trust=CASE WHEN n.profile->'relationships' ? b.other_id THEN 65 ELSE 40 END,tension=0,updated_at=now()
  FROM npc_state AS n WHERE n.id=b.npc_id;
UPDATE npc_state SET x=(profile->'position'->>0)::double precision,z=(profile->'position'->>2)::double precision,
  goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',departed_at=NULL,sleep_on_arrival=false,
  emotion='neutral',stamina=100,hunger=0,thirst=0,coins=0,interaction_progress=0,last_stamina_at=now(),
  last_decision_at=NULL,next_thought_at=NULL,planned_wake_at=NULL,last_wake_day=1,updated_at=now();
INSERT INTO npc_inventory(npc_id,item_id,quantity)
  SELECT n.id,goods.item_id,1 FROM npc_state AS n CROSS JOIN (VALUES ('apple'),('water')) AS goods(item_id);
INSERT INTO npc_beliefs(npc_id,topic)
  SELECT n.id,topics.topic FROM npc_state AS n CROSS JOIN (VALUES ('walls'),('cesar'),('outside')) AS topics(topic);
UPDATE world_state SET started_at=now()-((3.6*1800/(12+5.0/2+7.0/10))*interval '1 second'),
  last_summary_day=0,meeting_day=0,next_npc_index=0,usage_report_started_at=now(),updated_at=now() WHERE id=1;
