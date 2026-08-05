-- Historical migration for D1 databases created before nicknames and event
-- summaries were part of cloudflare/d1/net_sphere.sql.
-- Prefer `npm run cf:schema`; scripts/cloudflare-net-setup.mjs reads this file
-- and applies ALTER TABLE statements with PRAGMA guards so fresh databases do
-- not fail on duplicate columns.
ALTER TABLE net_players ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE net_events ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE net_events ADD COLUMN summary TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_net_events_created ON net_events (created_at);
