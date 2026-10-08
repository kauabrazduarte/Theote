CREATE TABLE goblin_torments (
  message_id bigint PRIMARY KEY REFERENCES dialogue_messages(id) ON DELETE CASCADE,
  npc_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rumor','lure','demand','doubt')),
  named_npc_id text REFERENCES npc_state(id) ON DELETE SET NULL,
  topic text CHECK (topic IN ('walls','cesar','outside')),
  believed boolean,
  remembered boolean,
  followed boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX goblin_torments_recent_idx ON goblin_torments(created_at DESC);

ALTER TABLE npc_notifications DROP CONSTRAINT npc_notifications_conversation_response_check;
ALTER TABLE npc_notifications ADD CONSTRAINT npc_notifications_conversation_response_check
  CHECK (conversation_response IN ('replied','ignored','unavailable','considered'));
