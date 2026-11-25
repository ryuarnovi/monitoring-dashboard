import { connect } from 'cloudflare:sockets';
import { Target, TargetStatus, ProbeResult } from '../types';

export interface ProberOptions {
  colo?: string | null;
  defaultTimeoutMs?: number;
  degradedLatencyThresholdMs?: number;
}

const USER_AGENT = 'Cloudflare-ZeroAgent-Probe/1.0 (+https://github.com/ryuarnovi/monitoring-dashboard)';

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

/** Standard probe via fetch(). Used for DNS hostnames. */
async function probeViaFetch(url: string, timeoutMs: number): Promise<RawOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Cache-Control': 'no-cache' },
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
 * Workers' fetch() cannot target bare IP addresses, so IP targets are checked by
 * opening a TCP connection and sending a minimal HTTP/1.1 request. The elapsed
 * time covers TCP connect + time to the first response line.
 */
async function probeViaSocket(target: Target, timeoutMs: number): Promise<RawOutcome> {
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
      `User-Agent: ${USER_AGENT}\r\n` +
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
  const url = buildUrl(target);

  const outcome = isIpAddress(target.host)
    ? await probeViaSocket(target, timeoutMs)
    : await probeViaFetch(url, timeoutMs);

  const { statusCode } = outcome;
  let errorMessage = outcome.error;
  const responseTimeMs = outcome.elapsedMs;

  let status: TargetStatus;
  if (statusCode === null) {
    status = 'offline';
  } else if (statusCode >= 500) {
    status = 'offline';
    errorMessage = `HTTP server error (${statusCode})`;
  } else if (target.expected_status && statusCode !== target.expected_status) {
    status = 'degraded';
    errorMessage = `Unexpected status code: received ${statusCode}, expected ${target.expected_status}`;
  } else if (responseTimeMs >= degradedThresholdMs) {
    status = 'degraded';
    errorMessage = `High HTTP latency: ${responseTimeMs}ms (threshold ${degradedThresholdMs}ms)`;
  } else {
    status = 'online';
  }

  return {
    target_id: target.id,
    url,
    status,
    status_code: statusCode,
    // An offline probe has no meaningful latency value
    response_time_ms: statusCode === null ? null : responseTimeMs,
    colo: options.colo || 'unknown',
    error_message: errorMessage,
    probe_method: outcome.method,
  };
}
