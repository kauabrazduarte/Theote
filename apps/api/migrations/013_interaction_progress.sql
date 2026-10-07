ALTER TABLE npc_state ADD COLUMN IF NOT EXISTS interaction_progress integer NOT NULL DEFAULT 0 CHECK (interaction_progress BETWEEN 0 AND 19);

CREATE TABLE IF NOT EXISTS npc_social_interactions (
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('dialogue','unanswered')),
  source_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (npc_id,source_type,source_id)
);
