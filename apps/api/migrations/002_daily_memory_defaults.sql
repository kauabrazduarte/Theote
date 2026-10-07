ALTER TABLE world_state ALTER COLUMN last_summary_day SET DEFAULT 0;
UPDATE world_state SET last_summary_day=0 WHERE id=1;
ALTER TABLE npc_memories ALTER COLUMN last_summarized_day SET DEFAULT 0;
UPDATE npc_memories SET last_summarized_day=0;
