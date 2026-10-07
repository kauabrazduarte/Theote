import postgres from 'postgres';
import profiles from '@theote/npcs/data/characters.json';
import houses from '@theote/npcs/data/houses.json';

export const db = postgres(process.env.DATABASE_URL!, { max: 6, idle_timeout: 30, connect_timeout: 10, prepare: false });
const HOUSES = Object.fromEntries(houses.map(house=>[house.id,house.entrance])) as Record<string,[number,number]>;

export async function initializeDatabase() {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const migrationNames=['initial','daily_memory_defaults','agent_thoughts','scheduled_wake','scheduled_thought','meetings_notifications','conversation_waits','group_dialogues','cardial','faster_nights','usage_report_epoch','coins','interaction_progress','late_night_speed','needs_market_departure','coin_spending','group_replies','written_agreements','one_pending_agreement_per_pair','expansion_memory_invitations','catalog_and_need_history','invitation_reminders','village_streets'];
  for(const [index,suffix] of migrationNames.entries()) {
    const version=index+1;
    const [applied]=await db`SELECT 1 FROM schema_migrations WHERE version=${version}`;
    if(applied)continue;
    const migration=await Bun.file(new URL(`../migrations/${String(version).padStart(3,'0')}_${suffix}.sql`,import.meta.url)).text();
    await db.begin(async tx=>{await tx.unsafe(migration);await tx`INSERT INTO schema_migrations(version) VALUES (${version}) ON CONFLICT DO NOTHING`;});
  }
  for (const profile of profiles) {
    const [x, , z] = profile.position;
    await db`INSERT INTO npc_state (id,name,home_id,profile,x,z) VALUES (${profile.id},${profile.name},${profile.home},${db.json(profile)},${x},${z})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,home_id=EXCLUDED.home_id,profile=EXCLUDED.profile,updated_at=now()`;
    await db`INSERT INTO npc_memories(npc_id) VALUES (${profile.id}) ON CONFLICT (npc_id) DO NOTHING`;
    await db`INSERT INTO npc_affect(npc_id) VALUES (${profile.id}) ON CONFLICT (npc_id) DO NOTHING`;
    for(const topic of ['walls','cesar','outside'])await db`INSERT INTO npc_beliefs(npc_id,topic) VALUES (${profile.id},${topic}) ON CONFLICT (npc_id,topic) DO NOTHING`;
    for(const itemId of ['apple','water'])await db`INSERT INTO npc_inventory(npc_id,item_id,quantity) VALUES (${profile.id},${itemId},1) ON CONFLICT (npc_id,item_id) DO NOTHING`;
  }
  for(const profile of profiles)for(const other of profiles)if(profile.id!==other.id) {
    const family=Boolean(profile.relationships[other.id]);
    await db`INSERT INTO npc_bonds(npc_id,other_id,warmth,trust) VALUES (${profile.id},${other.id},${family?45:0},${family?65:40}) ON CONFLICT (npc_id,other_id) DO NOTHING`;
  }
  await db`DELETE FROM ai_cost_reservations WHERE created_at < now() - interval '10 minutes'`;
}

export function homeEntrance(homeId:string):[number,number] { return HOUSES[homeId] ?? [0,0]; }
