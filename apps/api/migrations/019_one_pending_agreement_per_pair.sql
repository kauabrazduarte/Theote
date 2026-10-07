CREATE UNIQUE INDEX npc_agreements_one_pending_pair_idx
  ON npc_agreements (LEAST(proposer_id,recipient_id), GREATEST(proposer_id,recipient_id))
  WHERE status = 'proposed';
