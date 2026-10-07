ALTER TABLE npc_inventory DROP CONSTRAINT IF EXISTS npc_inventory_item_id_check;
ALTER TABLE npc_inventory ADD CONSTRAINT npc_inventory_item_id_nonempty CHECK (length(item_id) BETWEEN 1 AND 64);
ALTER TABLE npc_item_events ADD COLUMN need_before double precision;
ALTER TABLE npc_item_events ADD COLUMN need_after double precision;
ALTER TABLE npc_item_events ADD COLUMN joy_gain smallint;
