CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  rules TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
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