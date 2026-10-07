ALTER TABLE npc_state
  ADD COLUMN IF NOT EXISTS last_wake_day integer NOT NULL DEFAULT 0;
