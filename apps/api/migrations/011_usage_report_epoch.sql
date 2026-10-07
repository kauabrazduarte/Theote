-- Hide earlier usage from charts without deleting the billing ledger used by the monthly cap.
ALTER TABLE world_state ADD COLUMN IF NOT EXISTS usage_report_started_at timestamptz NOT NULL DEFAULT now();
