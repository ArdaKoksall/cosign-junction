ALTER TABLE trade_runs
  ADD COLUMN receipt JSONB,
  ADD COLUMN rehearsal_key_hash TEXT,
  ADD CONSTRAINT trade_runs_rehearsal_receipt
    CHECK ((receipt IS NULL AND rehearsal_key_hash IS NULL)
        OR (receipt IS NOT NULL AND rehearsal_key_hash IS NOT NULL AND status = 'completed'));

CREATE UNIQUE INDEX trade_runs_rehearsal_key ON trade_runs(account_id, rehearsal_key_hash);
