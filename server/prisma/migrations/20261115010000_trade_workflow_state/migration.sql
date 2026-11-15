ALTER TABLE trade_runs
  ADD COLUMN approval_waits JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN creation_fingerprint TEXT;
