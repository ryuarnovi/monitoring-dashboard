import { Env } from './types';
import { 
  authorizeRequest, 
  verifyAdminPassword, 
  createSessionToken,
  sha256
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
  getSetting,
  setSetting,
  getAllSettings,
  isSetupRequired,
} from './db';
import { Target, DashboardOverview, SystemSettings } from '../types';

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

export async function getDynamicThreshold(env: Env): Promise<number> {
  const envVal = Number(env.LATENCY_DEGRADED_THRESHOLD_MS);
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  const dbVal = await getSetting(env.DB, 'latency_threshold_ms', '1000');
  const parsed = Number(dbVal);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
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
  // 1. PUBLIC SYSTEM SETTINGS & SETUP ENDPOINTS
  // -------------------------------------------------------------

  // GET /api/system/settings (Publicly accessible basic config)
  if (path === '/api/system/settings' && method === 'GET') {
    const settings = await getAllSettings(env.DB);
    const setupNeeded = await isSetupRequired(env.DB, env.ADMIN_PASSWORD);
    const threshold = await getDynamicThreshold(env);

    const publicSettings: SystemSettings = {
      app_title: settings.app_title || 'VPS Monitoring Dashboard',
      latency_threshold_ms: threshold,
      github_url: settings.github_url || '',
      is_setup_required: setupNeeded,
      login_rate_limit_max: Number(settings.login_rate_limit_max) || 5,
      login_rate_limit_window: Number(settings.login_rate_limit_window) || 900,
      probe_rate_limit_max: Number(settings.probe_rate_limit_max) || 10,
      api_rate_limit_max: Number(settings.api_rate_limit_max) || 60,
      max_targets: Number(settings.max_targets) || 15,
      retention_days: Number(env.RETENTION_DAYS) || Number(settings.retention_days) || 30,
      custom_user_agent: settings.custom_user_agent || '',
    };

    return json({ success: true, data: publicSettings });
  }

  // POST /api/auth/setup (Initial setup: only if password is not configured yet)
  if (path === '/api/auth/setup' && method === 'POST') {
    const setupNeeded = await isSetupRequired(env.DB, env.ADMIN_PASSWORD);
    if (!setupNeeded) {
      return json({ success: false, error: 'System is already initialized' }, 400);
    }

    const body = (await request.json().catch(() => null)) as any;
    const password = String(body?.password ?? '').trim();
    const appTitle = String(body?.app_title ?? '').trim() || 'VPS Monitoring Dashboard';
    const githubUrl = String(body?.github_url ?? '').trim();

    if (!password || password.length < 8) {
      return json({ success: false, error: 'Password must be at least 8 characters long' }, 400);
    }

    const passwordHash = await sha256(password);
    await setSetting(env.DB, 'admin_password_hash', passwordHash);
    await setSetting(env.DB, 'app_title', appTitle);
    if (githubUrl) {
      await setSetting(env.DB, 'github_url', githubUrl);
    }

    // Automatically log in the admin
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
    await saveSession(env.DB, sessionId, 'admin', expiresAt);
    const token = await createSessionToken('admin', env);

    const isHttps = url.protocol === 'https:';
    const secureFlag = isHttps ? '; Secure' : '';
    const cookieVal = `vps_auth_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureFlag}`;

    return json(
      { success: true, message: 'System setup completed successfully', token },
      200,
      { 'Set-Cookie': cookieVal }
    );
  }

  // -------------------------------------------------------------
  // 2. AUTHENTICATION & LOGIN (Throttled & Anti-Bypass)
  // -------------------------------------------------------------

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    // Dynamic login rate limits from DB
    const loginMax = Number(await getSetting(env.DB, 'login_rate_limit_max', '5')) || 5;
    const loginWindow = Number(await getSetting(env.DB, 'login_rate_limit_window', '900')) || 900;

    const rl = await checkRateLimit(env.DB, `login_${clientIp}`, loginMax, loginWindow);
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

    const setupNeeded = await isSetupRequired(env.DB, env.ADMIN_PASSWORD);
    if (setupNeeded) {
      return json(
        {
          success: false,
          error: 'Initial setup required. Please configure the admin password.',
          setup_required: true,
        },
        400,
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

    // Login successful
    const sessionId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 days
    await saveSession(env.DB, sessionId, 'admin', expiresAt);
    const token = await createSessionToken('admin', env);

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
    const setupNeeded = await isSetupRequired(env.DB, env.ADMIN_PASSWORD);
    if (setupNeeded) {
      return json({
        authenticated: false,
        setup_required: true,
      });
    }

    const auth = await authorizeRequest(request, env);
    return json({
      authenticated: auth.ok,
      user: auth.user || null,
      method: auth.method || null,
      setup_required: false,
    });
  }

  // -------------------------------------------------------------
  // 3. AUTHORIZATION CHECK (MANDATORY FOR ALL REMAINING ROUTES)
  // -------------------------------------------------------------
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) {
    const setupNeeded = await isSetupRequired(env.DB, env.ADMIN_PASSWORD);
    return json(
      {
        success: false,
        error: 'Unauthorized: Access restricted',
        reason: auth.reason,
        requires_login: true,
        setup_required: setupNeeded,
      },
      401
    );
  }

  // -------------------------------------------------------------
  // 4. RATE LIMITING / THROTTLING FOR PROTECTED ACTIONS
  // -------------------------------------------------------------
  const probeMax = Number(await getSetting(env.DB, 'probe_rate_limit_max', '10')) || 10;
  const apiMax = Number(await getSetting(env.DB, 'api_rate_limit_max', '60')) || 60;

  if (path.includes('/probe') && method === 'POST') {
    const probeRl = await checkRateLimit(env.DB, `probe_${clientIp}`, probeMax, 60);
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
    const apiRl = await checkRateLimit(env.DB, `api_${clientIp}`, apiMax, 60);
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
  // 5. BUSINESS LOGIC & DATA ENDPOINTS
  // -------------------------------------------------------------
  const cf = ((request as any).cf || {}) as { colo?: string; country?: string; city?: string };
  const edgeColo = cf.colo || 'unknown';
  const threshold = await getDynamicThreshold(env);
  const customUserAgent = await getSetting(env.DB, 'custom_user_agent');
  const probeOpts = { 
    colo: edgeColo, 
    degradedLatencyThresholdMs: threshold,
    userAgent: customUserAgent || undefined
  };

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

      const appTitle = await getSetting(env.DB, 'app_title', 'VPS Monitoring Dashboard');

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
        app_title: appTitle,
      };
      return json({ success: true, data: overview });
    }

    // PUT /api/system/settings (Update dynamic system settings)
    if (path === '/api/system/settings' && method === 'PUT') {
      const body = (await request.json().catch(() => ({}))) as any;

      if (body.app_title !== undefined) {
        await setSetting(env.DB, 'app_title', String(body.app_title).trim());
      }
      if (body.latency_threshold_ms !== undefined) {
        const val = Number(body.latency_threshold_ms);
        if (val > 0) await setSetting(env.DB, 'latency_threshold_ms', String(val));
      }
      if (body.github_url !== undefined) {
        await setSetting(env.DB, 'github_url', String(body.github_url).trim());
      }
      if (body.custom_user_agent !== undefined) {
        await setSetting(env.DB, 'custom_user_agent', String(body.custom_user_agent).trim());
      }
      if (body.retention_days !== undefined) {
        const val = Number(body.retention_days);
        if (val > 0) await setSetting(env.DB, 'retention_days', String(val));
      }
      if (body.max_targets !== undefined) {
        const val = Number(body.max_targets);
        if (val > 0) await setSetting(env.DB, 'max_targets', String(val));
      }
      if (body.new_admin_password && String(body.new_admin_password).length >= 8) {
        const newHash = await sha256(String(body.new_admin_password).trim());
        await setSetting(env.DB, 'admin_password_hash', newHash);
      }

      return json({ success: true, message: 'Settings updated successfully' });
    }

    // GET /api/targets
    if (path === '/api/targets' && method === 'GET') {
      return json({ success: true, data: await getAllTargetsWithStats(env.DB) });
    }

    // POST /api/targets
    if (path === '/api/targets' && method === 'POST') {
      const maxTargets = Number(await getSetting(env.DB, 'max_targets', '15')) || 15;
      if ((await countTargets(env.DB)) >= maxTargets) {
        return json({ success: false, error: `Maximum of ${maxTargets} targets reached` }, 400);
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
