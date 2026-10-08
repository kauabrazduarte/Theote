ALTER TABLE npc_notifications
  ADD COLUMN dialogue_message_id bigint REFERENCES dialogue_messages(id) ON DELETE SET NULL,
  ADD COLUMN conversation_response text CHECK (conversation_response IN ('replied','ignored','unavailable'));

CREATE INDEX npc_notifications_conversation_pending_idx
  ON npc_notifications(npc_id,id DESC)
  WHERE dialogue_message_id IS NOT NULL AND conversation_response IS NULL;
