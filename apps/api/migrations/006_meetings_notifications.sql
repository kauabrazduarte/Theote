ALTER TABLE world_state ADD COLUMN IF NOT EXISTS meeting_day integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS npc_notifications (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS npc_notifications_pending_idx ON npc_notifications(npc_id,id) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS npc_proximity (
  npc_a text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  npc_b text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  PRIMARY KEY(npc_a,npc_b),
  CHECK(npc_a<npc_b)
);
