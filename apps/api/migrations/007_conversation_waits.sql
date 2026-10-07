CREATE TABLE IF NOT EXISTS npc_conversation_waits (
  message_id bigint PRIMARY KEY REFERENCES dialogue_messages(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES npc_state(id) ON DELETE CASCADE,
  deadline_at timestamptz NOT NULL,
  notified_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS npc_conversation_waits_due_idx ON npc_conversation_waits(deadline_at) WHERE notified_at IS NULL AND resolved_at IS NULL;
