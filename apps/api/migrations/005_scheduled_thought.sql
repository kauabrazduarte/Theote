ALTER TABLE npc_state ADD COLUMN IF NOT EXISTS next_thought_at timestamptz;
ALTER TABLE npc_state ADD COLUMN IF NOT EXISTS planned_wake_at timestamptz;
ALTER TABLE npc_state DROP CONSTRAINT IF EXISTS npc_state_mode_check;
ALTER TABLE npc_state ADD CONSTRAINT npc_state_mode_check CHECK (mode IN ('wandering','walking','following','sleeping','resting','waiting'));
