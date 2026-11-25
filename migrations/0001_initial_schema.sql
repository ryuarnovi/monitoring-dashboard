-- Cloudflare D1 Database Schema for Zero-Agent VPS Monitoring
-- Supports external-only HTTP/HTTPS probes, latency metrics, downtime history,
-- anti-bypass session management, dynamic system settings, and sliding-window rate limiting.

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 80,
  protocol TEXT NOT NULL CHECK(protocol IN ('http', 'https')) DEFAULT 'http',
  path TEXT NOT NULL DEFAULT '/',
  expected_status INTEGER DEFAULT 200,
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_checks (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('online', 'degraded', 'offline')),
  status_code INTEGER,
  response_time_ms REAL,
  colo TEXT,
  error_message TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  duration_seconds INTEGER,
  cause TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ongoing', 'resolved')) DEFAULT 'ongoing',
  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
);

-- Anti-bypass active session store
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at INTEGER NOT NULL
);

-- Dynamic request throttling & sliding window rate limiter
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Dynamic system settings and preferences (NO HARDCODED VALUES)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indices for high performance queries
CREATE INDEX IF NOT EXISTS idx_checks_target_timestamp ON health_checks(target_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON health_checks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_target ON incidents(target_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
