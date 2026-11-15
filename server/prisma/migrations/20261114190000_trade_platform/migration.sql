-- Production identity, OAuth grants, durable agent runs and account-scoped evidence.
CREATE TABLE trade_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, customer_id TEXT NOT NULL,
  policy JSONB NOT NULL DEFAULT '{"automaticLimitCents":0,"requiredClaims":[],"freeFromAllergens":[]}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE trade_sessions (
  hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE trade_clients (id TEXT PRIMARY KEY, metadata JSONB NOT NULL);
CREATE TABLE trade_authorizations (
  hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES trade_clients(id),
  account_id TEXT REFERENCES trade_accounts(id), params JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, approved BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE trade_grants (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES trade_accounts(id),
  client_id TEXT NOT NULL REFERENCES trade_clients(id), scopes TEXT[] NOT NULL,
  revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE trade_tokens (
  hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES trade_grants(id),
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX trade_tokens_grant ON trade_tokens(grant_id);
CREATE TABLE trade_runs (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES trade_accounts(id),
  actor_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('mcp','nemotron','web')),
  status TEXT NOT NULL DEFAULT 'active', title TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '{}', comparison JSONB, draft JSONB,
  revision INTEGER NOT NULL DEFAULT 0, approved_revision INTEGER,
  messages JSONB NOT NULL DEFAULT '[]', step INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ, lease_owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trade_runs_account ON trade_runs(account_id, created_at DESC);
CREATE INDEX trade_runs_jobs ON trade_runs(source, status, lease_until);
CREATE TABLE trade_events (
  id BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL REFERENCES trade_accounts(id),
  run_id TEXT REFERENCES trade_runs(id), actor_id TEXT NOT NULL,
  action TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trade_events_account ON trade_events(account_id, id);
CREATE INDEX trade_events_run ON trade_events(run_id, id);
CREATE TABLE trade_tool_calls (
  run_id TEXT NOT NULL REFERENCES trade_runs(id), call_id TEXT NOT NULL,
  result JSONB NOT NULL, PRIMARY KEY(run_id, call_id)
);
