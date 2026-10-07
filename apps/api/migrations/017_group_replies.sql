ALTER TABLE dialogue_messages
  ADD COLUMN reply_to_message_id bigint REFERENCES dialogue_messages(id) ON DELETE SET NULL;
