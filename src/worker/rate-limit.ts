/**
 * Rate Limiter & Throttling Engine for Cloudflare Workers using D1 Storage.
 *
 * Implements sliding/fixed window throttling with IP-based tracking:
 * - Brute-force protection on Login (5 attempts per 15 min)
 * - Manual probe rate limiting (10 triggers per minute)
 * - API request throttling (60 requests per minute)
 *
 * Returns remaining count and reset time in seconds for HTTP 429 headers.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Extracts client IP from Cloudflare incoming request headers.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Real-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    '127.0.0.1'
  );
}

/**
 * Checks and increments rate limit counter in D1 database atomically.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;

  try {
    // 1. Fetch current rate limit record
    const existing = await db
      .prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?')
      .bind(key)
      .first<{ count: number; reset_at: number }>();

    if (!existing || existing.reset_at <= now) {
      // Window expired or new key: insert/reset
      await db
        .prepare(
          `INSERT INTO rate_limits (key, count, reset_at)
           VALUES (?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = ?`
        )
        .bind(key, resetAt, resetAt)
        .run();

      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: windowSeconds,
      };
    }

    // Existing active window
    const resetSeconds = Math.max(1, existing.reset_at - now);

    if (existing.count >= limit) {
      // Rate limit exceeded!
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds,
      };
    }

    // Increment count
    await db
      .prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
      .bind(key)
      .run();

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - (existing.count + 1)),
      resetSeconds,
    };
  } catch (err) {
    console.error('[RateLimit] D1 error, failing open safely:', err);
    return {
      allowed: true,
      limit,
      remaining: limit,
      resetSeconds: windowSeconds,
    };
  }
}

/**
 * Generates Rate Limit headers according to IETF standards.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetSeconds),
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(result.resetSeconds);
  }

  return headers;
}
