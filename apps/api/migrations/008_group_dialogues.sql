ALTER TABLE dialogue_messages ADD COLUMN IF NOT EXISTS participants jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dialogue_messages ADD CONSTRAINT dialogue_participants_array CHECK (jsonb_typeof(participants) = 'array');
CREATE INDEX IF NOT EXISTS dialogue_participants_idx ON dialogue_messages USING gin(participants);
