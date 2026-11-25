import { connect } from 'cloudflare:sockets';
import { Target, TargetStatus, ProbeResult } from '../types';

export interface ProberOptions {
  colo?: string | null;
  defaultTimeoutMs?: number;
  degradedLatencyThresholdMs?: number;
  userAgent?: string;
}

const DEFAULT_USER_AGENT = 'Cloudflare-ZeroAgent-Probe/1.0 (+https://developers.cloudflare.com/workers/)';

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function buildUrl(target: Pick<Target, 'protocol' | 'host' | 'port' | 'path'>): string {
  const defaultPort =
    (target.protocol === 'http' && target.port === 80) ||
    (target.protocol === 'https' && target.port === 443);
  const portSuffix = defaultPort ? '' : `:${target.port}`;
  const cleanPath = target.path.startsWith('/') ? target.path : `/${target.path}`;
  return `${target.protocol}://${target.host}${portSuffix}${cleanPath}`;
}

interface RawOutcome {
  statusCode: number | null;
  error: string | null;
  elapsedMs: number;
  method: 'fetch' | 'tcp';
}

/** Standard probe via fetch(). Used for DNS hostnames or HTTP endpoints. */
async function probeViaFetch(url: string, timeoutMs: number, userAgent: string): Promise<RawOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual', // Read the immediate status (e.g. 200, 301, 302)
      headers: { 'User-Agent': userAgent, Accept: '*/*', 'Cache-Control': 'no-cache' },
    });
    const elapsedMs = Date.now() - start;
    await res.body?.cancel();
    return { statusCode: res.status, error: null, elapsedMs, method: 'fetch' };
  } catch (err: any) {
    const elapsedMs = Date.now() - start;
    if (err?.name === 'AbortError') {
      return { statusCode: null, error: `Connection timed out after ${timeoutMs}ms`, elapsedMs, method: 'fetch' };
    }
    return { statusCode: null, error: err?.message || 'Network unreachable', elapsedMs, method: 'fetch' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe via raw TCP socket (cloudflare:sockets).
 * Used when direct IP socket connection is needed.
 */
async function probeViaSocket(target: Target, timeoutMs: number, userAgent: string): Promise<RawOutcome> {
  const start = Date.now();
  const cleanPath = target.path.startsWith('/') ? target.path : `/${target.path}`;
  let socket: ReturnType<typeof connect> | null = null;

  const work = (async (): Promise<RawOutcome> => {
    socket = connect(
      { hostname: target.host, port: target.port },
      { secureTransport: target.protocol === 'https' ? 'on' : 'off', allowHalfOpen: false }
    );
    await socket.opened;

    const writer = socket.writable.getWriter();
    const request =
      `GET ${cleanPath} HTTP/1.1\r\n` +
      `Host: ${target.host}\r\n` +
      `User-Agent: ${userAgent}\r\n` +
      `Accept: */*\r\n` +
      `Connection: close\r\n\r\n`;
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();

    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('\r\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8192) break;
    }
    const elapsedMs = Date.now() - start;
    reader.releaseLock();

    const match = buffer.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
    if (!match) {
      return { statusCode: null, error: 'TCP connected but no valid HTTP response', elapsedMs, method: 'tcp' };
    }
    return { statusCode: Number(match[1]), error: null, elapsedMs, method: 'tcp' };
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RawOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ statusCode: null, error: `Connection timed out after ${timeoutMs}ms`, elapsedMs: timeoutMs, method: 'tcp' }),
      timeoutMs
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } catch (err: any) {
    return {
      statusCode: null,
      error: err?.message || 'TCP connection refused or unreachable',
      elapsedMs: Date.now() - start,
      method: 'tcp',
    };
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined);
    try {
      (socket as any)?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function executeExternalProbe(target: Target, options: ProberOptions = {}): Promise<ProbeResult> {
  const timeoutMs = target.timeout_ms || options.defaultTimeoutMs || 5000;
  const degradedThresholdMs = options.degradedLatencyThresholdMs || 1000;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const url = buildUrl(target);

  // Dual-Method Probing with Auto-Fallback:
  // If target is an IP, start with socket; if target is a hostname, start with fetch.
  // If the initial method fails or is blocked by Cloudflare proxy policy (e.g. 1.1.1.1),
  // immediately fallback to the alternate method to guarantee reachability!
  let outcome = isIpAddress(target.host)
    ? await probeViaSocket(target, timeoutMs, userAgent)
    : await probeViaFetch(url, timeoutMs, userAgent);

  if (outcome.statusCode === null) {
    const fallback = isIpAddress(target.host)
      ? await probeViaFetch(url, timeoutMs, userAgent)
      : await probeViaSocket(target, timeoutMs, userAgent);
    if (fallback.statusCode !== null) {
      outcome = fallback;
    }
  }

  const { statusCode } = outcome;
  let errorMessage = outcome.error;
  const responseTimeMs = outcome.elapsedMs;

  // Status Evaluation with Smart HTTP Redirect Recognition
  let status: TargetStatus;
  const isRedirect = statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308;
  const expected = target.expected_status || 200;
  const isExpected = statusCode === expected || (expected === 200 && isRedirect) || (statusCode !== null && statusCode >= 200 && statusCode < 400 && expected === 200);

  if (statusCode === null) {
    status = 'offline';
  } else if (statusCode >= 500) {
    status = 'offline';
    errorMessage = `HTTP server error (${statusCode})`;
  } else if (!isExpected) {
    status = 'degraded';
    errorMessage = `Unexpected status code: received ${statusCode}, expected ${expected}`;
  } else if (responseTimeMs >= degradedThresholdMs) {
    status = 'degraded';
    errorMessage = `High HTTP latency: ${responseTimeMs}ms (threshold ${degradedThresholdMs}ms)`;
  } else {
    status = 'online';
    if (isRedirect && expected === 200) {
      errorMessage = null; // Clean: 301 redirects are healthy web behavior!
    }
  }

  return {
    target_id: target.id,
    url,
    status,
    status_code: statusCode,
    response_time_ms: statusCode === null ? null : responseTimeMs,
    colo: options.colo || 'unknown',
    error_message: errorMessage,
    probe_method: outcome.method,
  };
}
