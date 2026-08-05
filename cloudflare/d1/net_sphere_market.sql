-- Optional Net market tables for databases created before /api/net/market.
-- Fresh databases already get the same definitions from net_sphere.sql; tests
-- compare both files so the historical migration does not drift.
CREATE TABLE IF NOT EXISTS net_market_impulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  net_gen TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  magnitude REAL NOT NULL,
  created_at INTEGER NOT NULL,
  event_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_net_market_impulses_created
ON net_market_impulses (created_at);

CREATE INDEX IF NOT EXISTS idx_net_market_impulses_corp
ON net_market_impulses (corp_id);

CREATE INDEX IF NOT EXISTS idx_net_market_impulses_event_key
ON net_market_impulses (event_key);

CREATE TABLE IF NOT EXISTS net_market_budgets (
  identity_key TEXT PRIMARY KEY,
  net_gen TEXT NOT NULL,
  session_id TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  impulse_count INTEGER NOT NULL DEFAULT 0,
  magnitude_sum REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_net_market_budgets_net_gen
ON net_market_budgets (net_gen);

CREATE INDEX IF NOT EXISTS idx_net_market_budgets_window
ON net_market_budgets (window_started_at);

CREATE TABLE IF NOT EXISTS net_market_snapshots (
  corp_id TEXT PRIMARY KEY,
  price REAL NOT NULL,
  last_delta REAL NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_net_market_snapshots_updated
ON net_market_snapshots (updated_at);
