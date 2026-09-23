CREATE TABLE IF NOT EXISTS arena_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO arena_state (id, json) VALUES (1, '{"teams":[],"players":[],"matches":[]}');

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(expires_at);
