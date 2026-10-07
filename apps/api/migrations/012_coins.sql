ALTER TABLE npc_state ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 0 CHECK (coins >= 0);

CREATE TABLE IF NOT EXISTS npc_coin_events (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  other_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('earned','given','received')),
  amount integer NOT NULL CHECK (amount > 0),
  world_day integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS npc_coin_events_recent_idx ON npc_coin_events(npc_id,id DESC);
