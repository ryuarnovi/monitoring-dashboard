import { Env } from './types';
import { authorizeRequest } from './auth';
import { executeExternalProbe } from './prober';
import {
  getAllTargetsWithStats,
  getActiveTargets,
  getTargetById,
  recordCheckResult,
  getTargetLatencyHistory,
  getIncidents,
  createTarget,
  deleteTarget,
  countTargets,
} from './db';
import { Target, DashboardOverview } from '../types';

const MAX_TARGETS = 10;
const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
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

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return json({ success: false, error: 'Unauthorized', reason: auth.reason }, 401);

  // Basic CSRF protection for state-changing requests: same-origin only
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ success: false, error: 'Cross-origin request rejected' }, 403);
  }

  const cf = ((request as any).cf || {}) as { colo?: string; country?: string; city?: string };
  const edgeColo = cf.colo || 'unknown';
  const threshold = latencyThreshold(env);
  const probeOpts = { colo: edgeColo, degradedLatencyThresholdMs: threshold };

  try {
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
        access_user: auth.email ?? null,
        latency_threshold_ms: threshold,
      };
      return json({ success: true, data: overview });
    }

    if (path === '/api/targets' && method === 'GET') {
      return json({ success: true, data: await getAllTargetsWithStats(env.DB) });
    }

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

    const deleteMatch = path.match(/^\/api\/targets\/([\w-]+)$/);
    if (deleteMatch && method === 'DELETE') {
      await deleteTarget(env.DB, deleteMatch[1]);
      return json({ success: true });
    }

    const historyMatch = path.match(/^\/api\/targets\/([\w-]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const hours = parseInt(url.searchParams.get('hours') || '24', 10) || 24;
      return json({ success: true, data: await getTargetLatencyHistory(env.DB, historyMatch[1], hours) });
    }

    const probeMatch = path.match(/^\/api\/targets\/([\w-]+)\/probe$/);
    if (probeMatch && method === 'POST') {
      const target = await getTargetById(env.DB, probeMatch[1]);
      if (!target) return json({ success: false, error: 'Target not found' }, 404);
      const result = await executeExternalProbe(target, probeOpts);
      await recordCheckResult(env.DB, result);
      return json({ success: true, data: result });
    }

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

    if (path === '/api/incidents' && method === 'GET') {
      const targetId = url.searchParams.get('target_id') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10) || 50;
      return json({ success: true, data: await getIncidents(env.DB, limit, targetId) });
    }

    return json({ success: false, error: 'Endpoint not found' }, 404);
  } catch (err: any) {
    console.error('[API] error', err);
    return json({ success: false, error: 'Internal Server Error' }, 500);
  }
}
