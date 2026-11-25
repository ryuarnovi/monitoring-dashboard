import { Env } from './types';
import { handleApiRequest, latencyThreshold } from './api';
import { executeExternalProbe } from './prober';
import { getActiveTargets, recordCheckResult, pruneOldChecks } from './db';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

/** Discovers which Cloudflare data center is running this (cron) invocation. */
async function detectColo(): Promise<string> {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    const text = await res.text();
    return text.match(/^colo=(\w+)$/m)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function runScheduledProbes(env: Env, edgeColo?: string): Promise<void> {
  const targets = await getActiveTargets(env.DB);
  if (targets.length === 0) {
    console.log('[cron] no active targets');
    return;
  }
  // Prefer the PoP reported on the scheduled event; fall back to a trace lookup.
  const colo = edgeColo || (await detectColo());
  const threshold = latencyThreshold(env);

  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const r = await executeExternalProbe(t, { colo, degradedLatencyThresholdMs: threshold });
      await recordCheckResult(env.DB, r);
      console.log(`[cron] ${t.name} (${r.url}) -> ${r.status} code=${r.status_code} ${r.response_time_ms ?? '-'}ms via ${r.probe_method}@${colo}`);
    })
  );
  results.forEach((r) => r.status === 'rejected' && console.error('[cron] probe failed', r.reason));

  // Light housekeeping roughly once an hour
  if (new Date().getUTCMinutes() < 2) {
    await pruneOldChecks(env.DB, Number(env.RETENTION_DAYS) || 31);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return withSecurityHeaders(await handleApiRequest(request, env));
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // `cf` is present at runtime on scheduled events but omitted from older worker typings.
    const colo = (event as ScheduledController & { cf?: { colo?: string } }).cf?.colo;
    ctx.waitUntil(runScheduledProbes(env, colo).catch((err) => console.error('[cron] run failed', err)));
  },
} satisfies ExportedHandler<Env>;
