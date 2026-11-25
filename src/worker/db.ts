import { 
  Target, 
  Incident, 
  LatencyPoint, 
  ProbeResult, 
  TargetStatus,
  PaginatedResult 
} from '../types';

let schemaReady = false;

/**
 * Ensures tables exist in Cloudflare D1.
 * Starts with a completely clean slate (no hardcoded seeds).
 */
export async function initDatabase(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS targets (
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
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL CHECK(status IN ('online', 'degraded', 'offline')),
      status_code INTEGER,
      response_time_ms REAL,
      colo TEXT,
      error_message TEXT,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      duration_seconds INTEGER,
      cause TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ongoing', 'resolved')) DEFAULT 'ongoing',
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_checks_target_timestamp ON health_checks(target_id, timestamp DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON health_checks(timestamp DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_incidents_target ON incidents(target_id, start_time DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at)`),
  ]);
  schemaReady = true;
}

// -------------------------------------------------------------
// DYNAMIC SETTINGS & SYSTEM CONFIGURATION
// -------------------------------------------------------------

export async function getSetting(db: D1Database, key: string, defaultValue = ''): Promise<string> {
  await initDatabase(db);
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? defaultValue;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await initDatabase(db);
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(key, value, value)
    .run();
}

export async function getAllSettings(db: D1Database): Promise<Record<string, string>> {
  await initDatabase(db);
  const res = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of res.results || []) {
    out[row.key] = row.value;
  }
  return out;
}

/**
 * Returns dynamic session secret. If not provided via env, fetches from D1 or
 * generates a fresh random 64-character hex key and stores it in D1.
 */
export async function getOrGenerateSessionSecret(db: D1Database, envSecret?: string): Promise<string> {
  if (envSecret && envSecret.trim().length > 0) {
    return envSecret.trim();
  }
  const stored = await getSetting(db, 'session_secret');
  if (stored) return stored;

  // Generate dynamic cryptographic secret
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const newSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  await setSetting(db, 'session_secret', newSecret);
  return newSecret;
}

export async function isSetupRequired(db: D1Database, envPass?: string): Promise<boolean> {
  if (envPass && envPass.trim().length > 0) return false;
  const hash = await getSetting(db, 'admin_password_hash');
  return !hash || hash.trim().length === 0;
}

// -------------------------------------------------------------
// TARGETS & HEALTH CHECKS
// -------------------------------------------------------------

const round1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

const uptimePercent = (total: number | null | undefined, ok: number | null | undefined): number | null => {
  if (!total) return null;
  return Math.round(((ok ?? 0) / total) * 1000) / 10;
};

export async function getTargetById(db: D1Database, id: string): Promise<Target | null> {
  await initDatabase(db);
  return db.prepare('SELECT * FROM targets WHERE id = ?').bind(id).first<Target>();
}

export async function getActiveTargets(db: D1Database): Promise<Target[]> {
  await initDatabase(db);
  const res = await db.prepare('SELECT * FROM targets WHERE is_active = 1 ORDER BY created_at ASC').all<Target>();
  return res.results || [];
}

/** 
 * Retrieves all monitored targets along with live stats:
 * 24h, 7d, 30d uptime percentages and min/avg/max latency
 */
export async function getAllTargetsWithStats(db: D1Database): Promise<Target[]> {
  await initDatabase(db);
  const targets = (await db.prepare('SELECT * FROM targets ORDER BY created_at ASC').all<Target>()).results || [];

  return Promise.all(
    targets.map(async (t) => {
      const [latest, s24, s7, s30] = await db.batch([
        db
          .prepare(
            `SELECT status, status_code, response_time_ms, colo, error_message, timestamp
             FROM health_checks WHERE target_id = ? ORDER BY timestamp DESC LIMIT 1`
          )
          .bind(t.id),
        db
          .prepare(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS ok,
                    AVG(response_time_ms) AS avg_l,
                    MIN(response_time_ms) AS min_l,
                    MAX(response_time_ms) AS max_l
             FROM health_checks WHERE target_id = ? AND timestamp >= datetime('now', '-1 day')`
          )
          .bind(t.id),
        db
          .prepare(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS ok
             FROM health_checks WHERE target_id = ? AND timestamp >= datetime('now', '-7 day')`
          )
          .bind(t.id),
        db
          .prepare(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) AS ok
             FROM health_checks WHERE target_id = ? AND timestamp >= datetime('now', '-30 day')`
          )
          .bind(t.id),
      ]);

      const l = (latest.results?.[0] as any) || null;
      const a = (s24.results?.[0] as any) || {};
      const b = (s7.results?.[0] as any) || {};
      const c = (s30.results?.[0] as any) || {};

      return {
        ...t,
        current_status: l ? (l.status as TargetStatus) : 'unknown',
        last_checked_at: l?.timestamp ?? null,
        last_status_code: l?.status_code ?? null,
        last_latency_ms: l?.response_time_ms ?? null,
        last_colo: l?.colo ?? null,
        last_error: l?.error_message ?? null,
        uptime_24h: uptimePercent(a.total, a.ok),
        uptime_7d: uptimePercent(b.total, b.ok),
        uptime_30d: uptimePercent(c.total, c.ok),
        avg_latency_24h: round1(a.avg_l),
        min_latency_24h: round1(a.min_l),
        max_latency_24h: round1(a.max_l),
        checks_24h: a.total ?? 0,
      } as Target;
    })
  );
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

/** 
 * Stores probe result and updates incident log
 */
export async function recordCheckResult(db: D1Database, result: ProbeResult): Promise<void> {
  await db
    .prepare(
      `INSERT INTO health_checks (id, target_id, timestamp, status, status_code, response_time_ms, colo, error_message)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`
    )
    .bind(
      newId('chk'),
      result.target_id,
      result.status,
      result.status_code,
      result.response_time_ms,
      result.colo,
      result.error_message
    )
    .run();

  const ongoing = await db
    .prepare(`SELECT id FROM incidents WHERE target_id = ? AND status = 'ongoing' LIMIT 1`)
    .bind(result.target_id)
    .first<{ id: string }>();

  if (result.status === 'offline' || result.status === 'degraded') {
    if (!ongoing) {
      const cause =
        result.error_message ||
        `Target ${result.status.toUpperCase()} (HTTP ${result.status_code ?? 'no response'})`;
      await db
        .prepare(`INSERT INTO incidents (id, target_id, start_time, cause, status) VALUES (?, ?, datetime('now'), ?, 'ongoing')`)
        .bind(newId('inc'), result.target_id, `[${result.status.toUpperCase()}] ${cause}`)
        .run();
    }
  } else if (ongoing) {
    await db
      .prepare(
        `UPDATE incidents
         SET end_time = datetime('now'),
             status = 'resolved',
             duration_seconds = CAST(strftime('%s', 'now') - strftime('%s', start_time) AS INTEGER)
         WHERE id = ?`
      )
      .bind(ongoing.id)
      .run();
  }
}

export async function getTargetLatencyHistory(db: D1Database, targetId: string, rangeHours = 24): Promise<LatencyPoint[]> {
  await initDatabase(db);
  const hours = Math.min(Math.max(rangeHours, 1), 24 * 30);
  const res = await db
    .prepare(
      `SELECT timestamp, status, status_code, response_time_ms, colo
       FROM health_checks
       WHERE target_id = ? AND timestamp >= datetime('now', ?)
       ORDER BY timestamp ASC`
    )
    .bind(targetId, `-${hours} hours`)
    .all<{ timestamp: string; status: TargetStatus; status_code: number | null; response_time_ms: number | null; colo: string | null }>();

  return (res.results || []).map((r) => ({
    timestamp: r.timestamp,
    latency_ms: r.response_time_ms,
    status: r.status,
    status_code: r.status_code,
    colo: r.colo,
  }));
}

/**
 * Server-side paginated incidents retrieval
 */
export async function getIncidentsPaginated(
  db: D1Database,
  page: number = 1,
  limit: number = 10,
  targetId?: string
): Promise<PaginatedResult<Incident>> {
  await initDatabase(db);
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const offset = (safePage - 1) * safeLimit;

  let countSql = `SELECT COUNT(*) as total FROM incidents`;
  let dataSql = `SELECT i.*, t.name AS target_name FROM incidents i JOIN targets t ON i.target_id = t.id`;

  let total = 0;
  let items: Incident[] = [];

  if (targetId) {
    countSql += ` WHERE target_id = ?`;
    dataSql += ` WHERE i.target_id = ? ORDER BY i.start_time DESC LIMIT ? OFFSET ?`;

    const countRow = await db.prepare(countSql).bind(targetId).first<{ total: number }>();
    total = countRow?.total ?? 0;

    const dataRes = await db.prepare(dataSql).bind(targetId, safeLimit, offset).all<Incident>();
    items = dataRes.results || [];
  } else {
    dataSql += ` ORDER BY i.start_time DESC LIMIT ? OFFSET ?`;

    const countRow = await db.prepare(countSql).first<{ total: number }>();
    total = countRow?.total ?? 0;

    const dataRes = await db.prepare(dataSql).bind(safeLimit, offset).all<Incident>();
    items = dataRes.results || [];
  }

  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total_records: total,
      total_pages: totalPages,
      has_next: safePage < totalPages,
      has_prev: safePage > 1,
    },
  };
}

export async function countTargets(db: D1Database): Promise<number> {
  await initDatabase(db);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM targets').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createTarget(db: D1Database, target: Omit<Target, 'created_at' | 'updated_at'>): Promise<void> {
  await initDatabase(db);
  await db
    .prepare(
      `INSERT INTO targets (id, name, host, port, protocol, path, expected_status, timeout_ms, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      target.id,
      target.name,
      target.host,
      target.port,
      target.protocol,
      target.path,
      target.expected_status ?? 200,
      target.timeout_ms,
      target.is_active
    )
    .run();
}

export async function deleteTarget(db: D1Database, targetId: string): Promise<void> {
  await initDatabase(db);
  await db.batch([
    db.prepare('DELETE FROM health_checks WHERE target_id = ?').bind(targetId),
    db.prepare('DELETE FROM incidents WHERE target_id = ?').bind(targetId),
    db.prepare('DELETE FROM targets WHERE id = ?').bind(targetId),
  ]);
}

/** 
 * Session Storage helpers
 */
export async function saveSession(db: D1Database, id: string, user: string, expiresAt: number): Promise<void> {
  await initDatabase(db);
  await db
    .prepare('INSERT INTO sessions (id, user, expires_at) VALUES (?, ?, ?)')
    .bind(id, user, expiresAt)
    .run();
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await initDatabase(db);
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

/** 
 * Maintenance: Pruning old health checks, expired sessions, and expired rate limits
 */
export async function pruneMaintenance(db: D1Database, retentionDays: number = 31): Promise<void> {
  await initDatabase(db);
  const days = Math.max(retentionDays, 7);
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db.prepare(`DELETE FROM health_checks WHERE timestamp < datetime('now', ?)`).bind(`-${days} days`),
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).bind(now),
  ]);
}
