/** D1 stores timestamps as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function parseUtc(ts: string): Date {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

export function formatUtc(ts: string | null | undefined): string {
  if (!ts) return '—';
  return parseUtc(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
}

export function formatAxisTime(ts: string, rangeHours: number): string {
  const d = parseUtc(ts);
  return rangeHours <= 24
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit' });
}

export async function apiFetch<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'same-origin', ...init });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.reason || body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}
