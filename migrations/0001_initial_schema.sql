-- Cloudflare D1 Database Schema for Zero-Agent VPS Monitoring
-- Supports external-only HTTP/HTTPS probes, latency metrics, and downtime history.

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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indices for high performance queries over millions of check points
CREATE INDEX IF NOT EXISTS idx_checks_target_timestamp ON health_checks(target_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON health_checks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_target ON incidents(target_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

-- Seed default initial target VPS nodes (including user's target node)
INSERT OR IGNORE INTO targets (id, name, host, port, protocol, path, expected_status, timeout_ms, is_active)
VALUES 
  ('vps-01-prod', 'VPS-01 Production Node', '103.127.139.23', 80, 'http', '/', 200, 5000, 1),
  ('cf-edge-probe', 'Cloudflare Edge Gateway', '1.1.1.1', 443, 'https', '/dns-query?name=cloudflare.com', 200, 3000, 1);
