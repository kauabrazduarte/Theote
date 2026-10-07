CREATE TABLE IF NOT EXISTS world_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_summary_day integer NOT NULL DEFAULT 0,
  next_npc_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_state (
  id text PRIMARY KEY,
  name text NOT NULL,
  home_id text NOT NULL,
  profile jsonb NOT NULL,
  x double precision NOT NULL,
  z double precision NOT NULL,
  goal_x double precision,
  goal_z double precision,
  goal_person_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'wandering' CHECK (mode IN ('wandering','walking','following','sleeping','resting')),
  sleep_on_arrival boolean NOT NULL DEFAULT false,
  emotion text NOT NULL DEFAULT 'neutral' CHECK (emotion IN ('neutral','happy','sad','angry','surprised','worried','thinking')),
  stamina double precision NOT NULL DEFAULT 100 CHECK (stamina >= 0 AND stamina <= 100),
  last_stamina_at timestamptz NOT NULL DEFAULT now(),
  last_decision_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_memories (
  npc_id text PRIMARY KEY REFERENCES npc_state(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  summarized_through_dialogue_id bigint NOT NULL DEFAULT 0,
  last_summarized_day integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE npc_memories ADD COLUMN IF NOT EXISTS last_summarized_day integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS npc_decisions (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  world_day integer NOT NULL,
  action text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  thought text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS npc_decisions_recent_idx ON npc_decisions(npc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS npc_decisions_day_idx ON npc_decisions(world_day, npc_id);

CREATE TABLE IF NOT EXISTS dialogue_messages (
  id bigserial PRIMARY KEY,
  world_day integer NOT NULL,
  from_npc_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  to_npc_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  speaker_name text NOT NULL,
  content text NOT NULL CHECK (length(content) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dialogue_recent_idx ON dialogue_messages(id DESC);
CREATE INDEX IF NOT EXISTS dialogue_sender_idx ON dialogue_messages(from_npc_id, id DESC);
CREATE INDEX IF NOT EXISTS dialogue_recipient_idx ON dialogue_messages(to_npc_id, id DESC);

CREATE TABLE IF NOT EXISTS model_usage (
  id bigserial PRIMARY KEY,
  npc_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('decision','dialogue','summary')),
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(14,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_usage_month_idx ON model_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS model_usage_character_idx ON model_usage(npc_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_cost_reservations (
  id uuid PRIMARY KEY,
  reserved_usd numeric(14,8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO world_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
