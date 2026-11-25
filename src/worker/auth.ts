import { Env } from './types';

/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare Access sits in front of monitor.DOMAIN.COM and injects the
 * `Cf-Access-Jwt-Assertion` header. We verify that token here as defence in
 * depth, so the Worker cannot be reached by bypassing Access (e.g. via the
 * *.workers.dev URL).
 *
 * Secure by default: if Access is not configured, requests are rejected unless
 * they come from localhost or ALLOW_UNAUTHENTICATED="true" is set explicitly.
 */

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let cachedKeys: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const KEY_CACHE_MS = 60 * 60 * 1000;

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  // Allocate a real ArrayBuffer so the result is a valid BufferSource for WebCrypto.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getAccessKeys(teamDomain: string): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < KEY_CACHE_MS) {
    return cachedKeys.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Failed to fetch Access certs (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  cachedKeys = { teamDomain, keys: body.keys || [], fetchedAt: Date.now() };
  return cachedKeys.keys;
}

export interface AuthResult {
  ok: boolean;
  email?: string | null;
  reason?: string;
}

export async function verifyAccessJwt(token: string, teamDomain: string, audience: string): Promise<AuthResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed token' };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: 'Invalid token encoding' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: 'Unsupported algorithm' };

  const keys = await getAccessKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'Signing key not found' };

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) return { ok: false, reason: 'Invalid signature' };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, reason: 'Token expired' };
  if (payload.nbf && payload.nbf > now + 60) return { ok: false, reason: 'Token not yet valid' };
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return { ok: false, reason: 'Invalid issuer' };

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(audience)) return { ok: false, reason: 'Invalid audience' };

  return { ok: true, email: payload.email ?? null };
}

export async function authorizeRequest(request: Request, env: Env): Promise<AuthResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();

  if (teamDomain && audience) {
    const token =
      request.headers.get('Cf-Access-Jwt-Assertion') ||
      request.headers.get('Cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
    if (!token) return { ok: false, reason: 'Missing Cloudflare Access token' };
    try {
      return await verifyAccessJwt(token, teamDomain, audience);
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'Access verification failed' };
    }
  }

  // Access not configured
  const host = new URL(request.url).hostname;
  if (host === 'localhost' || host === '127.0.0.1') return { ok: true, email: 'local-dev' };
  if (env.ALLOW_UNAUTHENTICATED === 'true') return { ok: true, email: null };

  return {
    ok: false,
    reason: 'Cloudflare Access is not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (or ALLOW_UNAUTHENTICATED=true for testing only).',
  };
}
