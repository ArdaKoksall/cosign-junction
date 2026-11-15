ALTER TABLE trade_runs
  ADD COLUMN request_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT trade_runs_request_changes_array CHECK (jsonb_typeof(request_changes) = 'array');
