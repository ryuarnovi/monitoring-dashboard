import { Env } from './types';
import { 
  authorizeRequest, 
  verifyAdminPassword, 
  createSessionToken 
} from './auth';
import { checkRateLimit, getClientIp, rateLimitHeaders } from './rate-limit';
import { executeExternalProbe } from './prober';
import {
  getAllTargetsWithStats,
  getActiveTargets,
  getTargetById,
  recordCheckResult,
  getTargetLatencyHistory,
  getIncidentsPaginated,
  createTarget,
  deleteTarget,
  countTargets,
  saveSession,
} from './db';
import { Target, DashboardOverview } from '../types';

const MAX_TARGETS = 10;
const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function json(data: unknown, status = 200, customHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...customHeaders,
    },
  });
}

export function latencyThreshold(env: Env): number {
  const n = Number(env.LATENCY_DEGRADED_THRESHOLD_MS);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

function validateTargetInput(body: any): { target?: Omit<Target, 'created_at' | 'updated_at'>; error?: string } {
  const name = String(body?.name ?? '').trim();
  const host = String(body?.host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const protocol = body?.protocol === 'https' ? 'https' : 'http';
  const port = Number(body?.port) || (protocol === 'https' ? 443 : 80);
  let path = String(body?.path ?? '/').trim() || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  const expected = Number(body?.expected_status) || 200;
  const timeout = Number(body?.timeout_ms) || 5000;

  if (!name || name.length > 80) return { error: 'Name is required (max 80 characters)' };
  if (!IPV4_RE.test(host) && !HOST_RE.test(host)) return { error: 'Host must be a valid hostname or IPv4 address' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Port must be between 1 and 65535' };
  if (path.length > 512 || /[\r\n\s]/.test(path)) return { error: 'Invalid health path' };
  if (expected < 100 || expected > 599) return { error: 'Expected status must be a valid HTTP status code' };
  if (timeout < 500 || timeout > 15000) return { error: 'Timeout must be between 500 and 15000 ms' };

  return {
    target: {
      id: `vps-${crypto.randomUUID().slice(0, 8)}`,
      name,
      host,
      port,
      protocol,
      path,
      expected_status: expected,
      timeout_ms: timeout,
      is_active: 1,
    },
  };
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientIp = getClientIp(request);

  // Cross-Origin check for state-changing operations
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) {
      return json({ success: false, error: 'Cross-origin request rejected' }, 403);
    }
  }

  // -------------------------------------------------------------
  // 1. AUTHENTICATION & LOGIN ENDPOINTS (Throttled & Anti-Bypass)
  // -------------------------------------------------------------

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    // Throttling: Max 5 attempts per 15 minutes (900 seconds)
    const rl = await checkRateLimit(env.DB, `login_${clientIp}`, 5, 900);
    const rlHeaders = rateLimitHeaders(rl);

    if (!rl.allowed) {
      return json(
        {
          success: false,
          error: `Too many login attempts. Please wait ${rl.resetSeconds} seconds before trying again.`,
          retry_after: rl.resetSeconds,
        },
        429,
        rlHeaders
      );
    }

    const body = (await request.json().catch(() => null)) as any;
    const password = String(body?.password ?? '');

    const isValid = await verifyAdminPassword(password, env);
    if (!isValid) {
      return json(
        {
          success: false,
          error: 'Invalid administrator password',
          remaining_attempts: rl.remaining,
        },
        401,
        rlHeaders
      );
    }

    // Login successful: create session
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 days
    await saveSession(env.DB, sessionId, 'admin', expiresAt);

    const token = await createSessionToken('admin', env);

    // Set HTTP-only Cookie with SameSite protection
    const isHttps = url.protocol === 'https:';
    const secureFlag = isHttps ? '; Secure' : '';
    const cookieVal = `vps_auth_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureFlag}`;

    return json(
      {
        success: true,
        message: 'Authenticated successfully',
        user: 'admin',
        token,
      },
      200,
      {
        'Set-Cookie': cookieVal,
        ...rlHeaders,
      }
    );
  }

  // POST /api/auth/logout
  if (path === '/api/auth/logout' && method === 'POST') {
    const isHttps = url.protocol === 'https:';
    const secureFlag = isHttps ? '; Secure' : '';
    const clearCookie = `vps_auth_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;

    return json(
      { success: true, message: 'Logged out successfully' },
      200,
      { 'Set-Cookie': clearCookie }
    );
  }

  // GET /api/auth/me (Check current auth status)
  if (path === '/api/auth/me' && method === 'GET') {
    const auth = await authorizeRequest(request, env);
    return json({
      authenticated: auth.ok,
      user: auth.user || null,
      method: auth.method || null,
    });
  }

  // -------------------------------------------------------------
  // 2. AUTHORIZATION CHECK (MANDATORY FOR ALL REMAINING ROUTES)
  // -------------------------------------------------------------
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) {
    return json(
      {
        success: false,
        error: 'Unauthorized: Access restricted',
        reason: auth.reason,
        requires_login: true,
      },
      401
    );
  }

  // -------------------------------------------------------------
  // 3. RATE LIMITING / THROTTLING FOR PROTECTED ACTIONS
  // -------------------------------------------------------------

  // Manual probes throttling: Max 10 per 60 seconds
  if (path.includes('/probe') && method === 'POST') {
    const probeRl = await checkRateLimit(env.DB, `probe_${clientIp}`, 10, 60);
    if (!probeRl.allowed) {
      return json(
        {
          success: false,
          error: `Probe rate limit exceeded. Please wait ${probeRl.resetSeconds}s.`,
          retry_after: probeRl.resetSeconds,
        },
        429,
        rateLimitHeaders(probeRl)
      );
    }
  } else {
    // General API throttling: Max 60 requests per 60 seconds
    const apiRl = await checkRateLimit(env.DB, `api_${clientIp}`, 60, 60);
    if (!apiRl.allowed) {
      return json(
        {
          success: false,
          error: `API rate limit exceeded. Please wait ${apiRl.resetSeconds}s.`,
          retry_after: apiRl.resetSeconds,
        },
        429,
        rateLimitHeaders(apiRl)
      );
    }
  }

  // -------------------------------------------------------------
  // 4. BUSINESS LOGIC & DATA ENDPOINTS
  // -------------------------------------------------------------
  const cf = ((request as any).cf || {}) as { colo?: string; country?: string; city?: string };
  const edgeColo = cf.colo || 'unknown';
  const threshold = latencyThreshold(env);
  const probeOpts = { colo: edgeColo, degradedLatencyThresholdMs: threshold };

  try {
    // GET /api/overview
    if (path === '/api/overview' && method === 'GET') {
      const targets = await getAllTargetsWithStats(env.DB);
      const withUptime = targets.filter((t) => t.uptime_24h !== null && t.uptime_24h !== undefined);
      const latencies = targets.map((t) => t.last_latency_ms).filter((l): l is number => typeof l === 'number');
      const lastScan = targets
        .map((t) => t.last_checked_at)
        .filter((x): x is string => !!x)
        .sort()
        .pop();

      const overview: DashboardOverview = {
        total_targets: targets.length,
        online_count: targets.filter((t) => t.current_status === 'online').length,
        degraded_count: targets.filter((t) => t.current_status === 'degraded').length,
        offline_count: targets.filter((t) => t.current_status === 'offline').length,
        unknown_count: targets.filter((t) => t.current_status === 'unknown').length,
        overall_uptime_24h: withUptime.length
          ? Math.round((withUptime.reduce((s, t) => s + (t.uptime_24h as number), 0) / withUptime.length) * 10) / 10
          : null,
        avg_latency_ms: latencies.length
          ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10
          : null,
        edge_location: { colo: edgeColo, country: cf.country || 'unknown', city: cf.city },
        last_scan_time: lastScan ?? null,
        access_user: auth.user ?? null,
        auth_method: auth.method,
        latency_threshold_ms: threshold,
      };
      return json({ success: true, data: overview });
    }

    // GET /api/targets
    if (path === '/api/targets' && method === 'GET') {
      return json({ success: true, data: await getAllTargetsWithStats(env.DB) });
    }

    // POST /api/targets
    if (path === '/api/targets' && method === 'POST') {
      if ((await countTargets(env.DB)) >= MAX_TARGETS) {
        return json({ success: false, error: `Maximum of ${MAX_TARGETS} targets reached` }, 400);
      }
      const body = await request.json().catch(() => null);
      const { target, error } = validateTargetInput(body);
      if (!target) return json({ success: false, error }, 400);

      await createTarget(env.DB, target);
      const probe = await executeExternalProbe(target as Target, probeOpts);
      await recordCheckResult(env.DB, probe);
      return json({ success: true, id: target.id, data: probe }, 201);
    }

    // DELETE /api/targets/:id
    const deleteMatch = path.match(/^\/api\/targets\/([\w-]+)$/);
    if (deleteMatch && method === 'DELETE') {
      await deleteTarget(env.DB, deleteMatch[1]);
      return json({ success: true, message: 'Target removed' });
    }

    // GET /api/targets/:id/history
    const historyMatch = path.match(/^\/api\/targets\/([\w-]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const hours = parseInt(url.searchParams.get('hours') || '24', 10) || 24;
      return json({ success: true, data: await getTargetLatencyHistory(env.DB, historyMatch[1], hours) });
    }

    // POST /api/targets/:id/probe (Instant on-demand external probe)
    const probeMatch = path.match(/^\/api\/targets\/([\w-]+)\/probe$/);
    if (probeMatch && method === 'POST') {
      const target = await getTargetById(env.DB, probeMatch[1]);
      if (!target) return json({ success: false, error: 'Target not found' }, 404);
      const result = await executeExternalProbe(target, probeOpts);
      await recordCheckResult(env.DB, result);
      return json({ success: true, data: result });
    }

    // POST /api/probes/run-all (Trigger external probe across all targets)
    if (path === '/api/probes/run-all' && method === 'POST') {
      const targets = await getActiveTargets(env.DB);
      const results = await Promise.all(
        targets.map(async (t) => {
          const r = await executeExternalProbe(t, probeOpts);
          await recordCheckResult(env.DB, r);
          return r;
        })
      );
      return json({ success: true, scanned_count: results.length, data: results });
    }

    // GET /api/incidents (SERVER-SIDE PAGINATION)
    if (path === '/api/incidents' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));
      const targetId = url.searchParams.get('target_id') || undefined;

      const paginated = await getIncidentsPaginated(env.DB, page, limit, targetId);

      return json({
        success: true,
        data: paginated.items,
        pagination: paginated.pagination,
      });
    }

    return json({ success: false, error: 'Endpoint not found' }, 404);
  } catch (err: any) {
    console.error('[API] error:', err);
    return json({ success: false, error: 'Internal Server Error' }, 500);
  }
}
