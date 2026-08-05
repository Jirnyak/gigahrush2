CREATE TABLE IF NOT EXISTS npc_submissions (
  submission_id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  author_contact_private TEXT NOT NULL,
  public_credit_name TEXT NOT NULL,
  consent_accepted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'needs_review', 'accepted', 'rejected', 'imported')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  file_keys TEXT NOT NULL,
  moderator_notes TEXT NOT NULL DEFAULT '',
  package_hash TEXT NOT NULL,
  sprite_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  preview_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS npc_submissions_status_idx
  ON npc_submissions (status, created_at);

CREATE INDEX IF NOT EXISTS npc_submissions_package_idx
  ON npc_submissions (package_id, created_at);

CREATE TABLE IF NOT EXISTS npc_intake_rate_limits (
  identity_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (identity_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS npc_intake_rate_limits_updated_idx
  ON npc_intake_rate_limits (updated_at);

CREATE TABLE IF NOT EXISTS npc_submission_files (
  submission_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_data BLOB NOT NULL,
  PRIMARY KEY (submission_id, file_name)
);
