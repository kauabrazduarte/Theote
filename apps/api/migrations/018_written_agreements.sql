CREATE TABLE npc_agreements (
  id bigserial PRIMARY KEY,
  proposer_id text NOT NULL REFERENCES npc_state(id),
  recipient_id text NOT NULL REFERENCES npc_state(id),
  source_message_id bigint NOT NULL REFERENCES dialogue_messages(id),
  terms text NOT NULL CHECK (length(terms) BETWEEN 12 AND 320),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','signed','declined')),
  proposed_day integer NOT NULL,
  decided_day integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (proposer_id <> recipient_id),
  UNIQUE (source_message_id, recipient_id)
);
CREATE INDEX npc_agreements_recipient_pending_idx ON npc_agreements(recipient_id, id DESC) WHERE status = 'proposed';
CREATE INDEX npc_agreements_recent_idx ON npc_agreements(id DESC);
