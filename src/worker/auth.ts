import { Env } from './types';
import { getSetting, getOrGenerateSessionSecret } from './db';

/**
 * Cloudflare VPS Monitor Authentication & Anti-Bypass Security Engine.
 *
 * Implements Multi-Layer Dynamic Security:
 * 1. Cloudflare Access (Zero Trust) JWT signature verification
 * 2. Cryptographic HMAC-SHA256 Session Tokens in HTTP-Only Cookies (dynamic per-instance salt)
 * 3. Secure Admin Password with Brute-Force Throttling (dynamic from Secrets or D1)
 *
 * ZERO HARDCODED PASSWORDS OR SECRETS.
 */

export interface AuthResult {
  ok: boolean;
  user?: string | null;
  method?: 'cf_access' | 'session' | 'local_dev';
  reason?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let cachedKeys: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const KEY_CACHE_MS = 60 * 60 * 1000;

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Computes SHA-256 hex string of input
 */
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates an HMAC-SHA256 signed session token with dynamic salt
 */
export async function createSessionToken(username: string, env: Env): Promise<string> {
  const secret = await getOrGenerateSessionSecret(env.DB, env.SESSION_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 86400; // 7 days expiration

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: username, iat: now, exp };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signatureB64 = base64UrlEncode(signature);

  return `${message}.${signatureB64}`;
}

/**
 * Verifies an HMAC-SHA256 signed session token with dynamic salt
 */
export async function verifySessionToken(token: string, env: Env): Promise<{ valid: boolean; user?: string }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [headerB64, payloadB64, signatureB64] = parts;
    const message = `${headerB64}.${payloadB64}`;
    const secret = await getOrGenerateSessionSecret(env.DB, env.SESSION_SECRET);

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const validSig = await crypto.subtle.verify(
      'HMAC',
      key,
      (base64UrlDecode(signatureB64) as unknown as BufferSource),
      new TextEncoder().encode(message)
    );

    if (!validSig) return { valid: false };

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return { valid: false };
    }

    return { valid: true, user: payload.sub || 'admin' };
  } catch {
    return { valid: false };
  }
}

/**
 * Validates admin password against environment secrets or D1 settings table.
 * NO HARDCODED PASSWORD!
 */
export async function verifyAdminPassword(password: string, env: Env): Promise<boolean> {
  const enteredHash = await sha256(password);

  // 1. Check environment variable (highest priority)
  if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.trim().length > 0) {
    const expectedHash = await sha256(env.ADMIN_PASSWORD.trim());
    return enteredHash === expectedHash;
  }

  // 2. Check D1 settings table
  const storedHash = await getSetting(env.DB, 'admin_password_hash');
  if (storedHash && storedHash.trim().length > 0) {
    return enteredHash === storedHash.trim();
  }

  return false;
}

/**
 * Fetches Cloudflare Access public keys
 */
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

/**
 * Verifies Cloudflare Access RS256 JWT
 */
export async function verifyAccessJwt(token: string, teamDomain: string, audience: string): Promise<AuthResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed Access token' };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: 'Invalid Access token encoding' };
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
    (base64UrlDecode(sigB64) as unknown as BufferSource),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );

  if (!valid) return { ok: false, reason: 'Invalid signature' };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, reason: 'Token expired' };
  if (payload.nbf && payload.nbf > now + 60) return { ok: false, reason: 'Token not yet valid' };
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return { ok: false, reason: 'Invalid issuer' };

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(audience)) return { ok: false, reason: 'Invalid audience' };

  return { ok: true, user: payload.email ?? 'access-user', method: 'cf_access' };
}

/**
 * Extracts session cookie or bearer token from request
 */
function extractSessionToken(request: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // 2. Cookie: vps_auth_token=<token>
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)vps_auth_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  return null;
}

/**
 * Authorizes incoming request via Cloudflare Access or Dashboard Session Token.
 * Rejects requests that fail all authentication layers.
 */
export async function authorizeRequest(request: Request, env: Env): Promise<AuthResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();

  // Layer 1: Cloudflare Access JWT validation (if configured in environment)
  if (teamDomain && audience) {
    const accessJwt =
      request.headers.get('Cf-Access-Jwt-Assertion') ||
      request.headers.get('Cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

    if (accessJwt) {
      try {
        const accessResult = await verifyAccessJwt(accessJwt, teamDomain, audience);
        if (accessResult.ok) return accessResult;
      } catch (err: any) {
        console.warn('[Auth] Access JWT validation failed:', err.message);
      }
    }
  }

  // Layer 2: Dashboard Session Token (HMAC-SHA256 in HTTP-only Cookie / Bearer header)
  const sessionToken = extractSessionToken(request);
  if (sessionToken) {
    const sessionResult = await verifySessionToken(sessionToken, env);
    if (sessionResult.valid) {
      return {
        ok: true,
        user: sessionResult.user || 'admin',
        method: 'session',
      };
    }
  }

  // Layer 3: Local Dev mode or explicitly unauthenticated testing
  const host = new URL(request.url).hostname;
  if ((host === 'localhost' || host === '127.0.0.1') && env.ALLOW_UNAUTHENTICATED === 'true') {
    return { ok: true, user: 'local-dev', method: 'local_dev' };
  }

  return {
    ok: false,
    reason: 'Authentication required. Please sign in with administrator credentials.',
  };
}
