ALTER TABLE npc_state ADD COLUMN hunger double precision NOT NULL DEFAULT 0 CHECK (hunger BETWEEN 0 AND 100);
ALTER TABLE npc_state ADD COLUMN thirst double precision NOT NULL DEFAULT 0 CHECK (thirst BETWEEN 0 AND 100);
ALTER TABLE npc_state ADD COLUMN departed_at timestamptz;
ALTER TABLE npc_state DROP CONSTRAINT IF EXISTS npc_state_mode_check;
ALTER TABLE npc_state ADD CONSTRAINT npc_state_mode_check CHECK (mode IN ('wandering','walking','following','sleeping','resting','waiting','departed'));

CREATE TABLE npc_inventory (
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (item_id IN ('apple','bread','water','juice')),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (npc_id,item_id)
);
CREATE TABLE npc_item_events (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  other_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  item_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bought','consumed','given','received')),
  world_day integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX npc_item_events_recent_idx ON npc_item_events(npc_id,id DESC);
