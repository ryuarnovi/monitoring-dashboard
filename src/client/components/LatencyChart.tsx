import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Target, LatencyPoint } from '../../types';
import { Activity, Clock, X } from 'lucide-react';
import { apiFetch, formatAxisTime, formatUtc } from '../format';

interface LatencyChartProps {
  server: Target | null;
  latencyThresholdMs: number;
  onClose: () => void;
}

const RANGES = [
  { label: '1H', value: 1 },
  { label: '6H', value: 6 },
  { label: '24H', value: 24 },
  { label: '7D', value: 168 },
  { label: '30D', value: 720 },
];

export const LatencyChart: React.FC<LatencyChartProps> = ({ server, latencyThresholdMs, onClose }) => {
  const [data, setData] = useState<LatencyPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    apiFetch<{ data: LatencyPoint[] }>(`/api/targets/${server.id}/history?hours=${hours}`)
      .then((r) => !cancelled && setData(r.data || []))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [server?.id, hours]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = useMemo(() => {
    const vals = data.map((d) => d.latency_ms).filter((v): v is number => typeof v === 'number');
    const failures = data.filter((d) => d.status === 'offline').length;
    if (!vals.length) return { min: null, max: null, avg: null, failures, samples: data.length };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
      failures,
      samples: data.length,
    };
  }, [data]);

  if (!server) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111726] border border-slate-700/80 rounded-2xl w-full max-w-4xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-orange-400" />
              <h2 className="text-lg font-bold text-white">HTTP Latency — {server.name}</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              HTTP response time measured externally from Cloudflare's edge. This is <strong>not</strong> ICMP ping.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setHours(r.value)}
                  className={`px-2.5 py-1 rounded font-medium transition ${hours === r.value ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 mb-6 text-center font-mono">
          <Stat label="Min" value={stats.min} className="text-emerald-400" />
          <Stat label="Average" value={stats.avg} className="text-orange-400" />
          <Stat label="Max" value={stats.max} className="text-amber-400" />
          <div>
            <span className="text-[11px] text-slate-400 block uppercase">Failed checks</span>
            <span className={`text-base font-bold ${stats.failures ? 'text-rose-400' : 'text-slate-300'}`}>
              {stats.failures}/{stats.samples}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 block uppercase">High threshold</span>
            <span className="text-base font-bold text-rose-400">≥ {latencyThresholdMs} ms</span>
          </div>
        </div>

        <div className="h-72 w-full">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mr-2" />
              Loading…
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-rose-400 text-sm">{error}</div>
          ) : data.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
              <Clock className="w-8 h-8 mb-2 text-slate-600" />
              <span>No probe data recorded in this time range yet.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F38020" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#F38020" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(ts) => formatAxisTime(ts, hours)}
                  stroke="#64748B"
                  fontSize={11}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis stroke="#64748B" fontSize={11} tickLine={false} unit="ms" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as LatencyPoint;
                    return (
                      <div className="bg-[#0E1322] border border-slate-700 p-3 rounded-lg shadow-xl text-xs font-mono">
                        <p className="text-slate-400 mb-1">{formatUtc(p.timestamp)}</p>
                        <p className="text-orange-400 font-bold">HTTP latency: {p.latency_ms ?? '—'} ms</p>
                        <p className={p.status === 'online' ? 'text-emerald-400' : p.status === 'degraded' ? 'text-amber-400' : 'text-rose-400'}>
                          {p.status.toUpperCase()} {p.status_code ? `(HTTP ${p.status_code})` : '(no response)'}
                        </p>
                        {p.colo && <p className="text-slate-500 text-[10px]">PoP: {p.colo}</p>}
                      </div>
                    );
                  }}
                />
                {stats.avg !== null && (
                  <ReferenceLine y={stats.avg} stroke="#10B981" strokeDasharray="3 3" label={{ value: `avg ${stats.avg}`, fill: '#10B981', fontSize: 10, position: 'insideBottomRight' }} />
                )}
                {stats.max !== null && stats.max >= latencyThresholdMs * 0.6 && (
                  <ReferenceLine y={latencyThresholdMs} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'high', fill: '#EF4444', fontSize: 10, position: 'insideTopRight' }} />
                )}
                <Area type="monotone" dataKey="latency_ms" stroke="#F38020" strokeWidth={2} fill="url(#latencyGradient)" connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <p className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500">
          Gaps in the line are failed checks (no HTTP response). Sample interval follows the Cron Trigger schedule.
        </p>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | null; className: string }> = ({ label, value, className }) => (
  <div>
    <span className="text-[11px] text-slate-400 block uppercase">{label}</span>
    <span className={`text-base font-bold ${className}`}>{value ?? '—'} ms</span>
  </div>
);
