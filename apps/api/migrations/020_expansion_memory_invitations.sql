CREATE TABLE npc_memory_events (
  id bigserial PRIMARY KEY,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  kind text NOT NULL,
  subject text NOT NULL,
  summary text NOT NULL CHECK (length(summary) <= 600),
  importance smallint NOT NULL DEFAULT 1 CHECK (importance BETWEEN 1 AND 5),
  world_day integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (npc_id,kind,subject,world_day)
);
CREATE INDEX npc_memory_events_recall_idx ON npc_memory_events(npc_id,importance DESC,world_day DESC);

CREATE TABLE npc_explorations (
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  site_id text NOT NULL,
  discovery text NOT NULL,
  world_day integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(npc_id,site_id)
);

CREATE TABLE npc_beliefs (
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('walls','cesar','outside')),
  stance smallint NOT NULL DEFAULT 0 CHECK (stance BETWEEN -100 AND 100),
  reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(npc_id,topic)
);

CREATE TABLE conversation_invitations (
  id bigserial PRIMARY KEY,
  host_id text NOT NULL REFERENCES npc_state(id),
  source_message_id bigint NOT NULL REFERENCES dialogue_messages(id),
  site_id text NOT NULL,
  x double precision NOT NULL,
  z double precision NOT NULL,
  target_day integer NOT NULL,
  target_hour smallint NOT NULL CHECK (target_hour BETWEEN 0 AND 23),
  target_minute smallint NOT NULL CHECK (target_minute BETWEEN 0 AND 59),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_invitations_time_idx ON conversation_invitations(target_day,target_hour,target_minute);

CREATE TABLE conversation_invitees (
  invitation_id bigint NOT NULL REFERENCES conversation_invitations(id) ON DELETE CASCADE,
  npc_id text NOT NULL REFERENCES npc_state(id),
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined')),
  travel_decision text CHECK (travel_decision IN ('going','skipping')),
  responded_at timestamptz,
  attended_at timestamptz,
  PRIMARY KEY(invitation_id,npc_id)
);
CREATE INDEX conversation_invitees_pending_idx ON conversation_invitees(npc_id,invitation_id) WHERE response='pending';
