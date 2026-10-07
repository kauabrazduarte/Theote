ALTER TABLE npc_coin_events DROP CONSTRAINT IF EXISTS npc_coin_events_kind_check;
ALTER TABLE npc_coin_events ADD CONSTRAINT npc_coin_events_kind_check CHECK (kind IN ('earned','given','received','spent'));
