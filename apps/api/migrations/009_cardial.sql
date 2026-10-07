ALTER TABLE dialogue_messages ADD COLUMN IF NOT EXISTS world_hour smallint NOT NULL DEFAULT 0 CHECK (world_hour BETWEEN 0 AND 23);
ALTER TABLE dialogue_messages ADD COLUMN IF NOT EXISTS world_minute smallint NOT NULL DEFAULT 0 CHECK (world_minute BETWEEN 0 AND 59);

CREATE TABLE IF NOT EXISTS npc_affect (
  npc_id text PRIMARY KEY REFERENCES npc_state(id) ON DELETE CASCADE,
  mood text NOT NULL DEFAULT 'neutral',
  pressure smallint NOT NULL DEFAULT 0 CHECK (pressure BETWEEN 0 AND 100),
  valence smallint NOT NULL DEFAULT 0 CHECK (valence BETWEEN -100 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_bonds (
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  other_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  warmth smallint NOT NULL DEFAULT 0 CHECK (warmth BETWEEN -100 AND 100),
  trust smallint NOT NULL DEFAULT 40 CHECK (trust BETWEEN 0 AND 100),
  tension smallint NOT NULL DEFAULT 0 CHECK (tension BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (npc_id,other_id),
  CHECK (npc_id <> other_id)
);

CREATE TABLE IF NOT EXISTS npc_feeling_events (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  other_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  world_day integer NOT NULL,
  emotion text NOT NULL,
  intensity smallint NOT NULL CHECK (intensity BETWEEN 0 AND 4),
  cause text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS npc_feeling_events_recent_idx ON npc_feeling_events(npc_id,id DESC);
