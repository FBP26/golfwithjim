CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  rules TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_tokens (
  digest TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_matches (
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  match_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (subscriber_id, match_key)
);
CREATE TABLE IF NOT EXISTS delivery_batches (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  message TEXT NOT NULL,
  match_keys TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS job_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS link_requests (
  bucket TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  endpoint TEXT NOT NULL UNIQUE,
  subscription TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_matches (
  device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, match_key)
);
CREATE TABLE IF NOT EXISTS signup_notifications (
  id TEXT PRIMARY KEY,
  device_kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_until INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS push_results (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);