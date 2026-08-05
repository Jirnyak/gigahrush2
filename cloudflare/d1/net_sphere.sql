-- Canonical fresh D1 schema for the hosted Net Sphere Worker.
-- Historical migration files remain in cloudflare/d1/ and are applied by
-- scripts/cloudflare-net-setup.mjs so older remote D1 databases converge here.
CREATE TABLE IF NOT EXISTS net_players (
  net_gen TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  total_samosbors INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 1,
  best_samosbor_count INTEGER NOT NULL DEFAULT 0,
  last_floor TEXT NOT NULL DEFAULT '',
  progress_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS net_sessions (
  session_id TEXT PRIMARY KEY,
  net_gen TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_net_sessions_last_seen
ON net_sessions (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_net_sessions_net_gen
ON net_sessions (net_gen);

CREATE TABLE IF NOT EXISTS net_events (
  event_key TEXT PRIMARY KEY,
  net_gen TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_net_events_type
ON net_events (type);

CREATE INDEX IF NOT EXISTS idx_net_events_net_gen
ON net_events (net_gen);

CREATE INDEX IF NOT EXISTS idx_net_events_created
ON net_events (created_at);

CREATE TABLE IF NOT EXISTS net_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  net_gen TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_net_chat_created
ON net_chat (created_at);

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
