import React from 'react';
import {
  Activity,
  ExternalLink,
  Cpu,
  HardDrive,
  Layers,
  Wifi,
  AlertTriangle,
  RefreshCw,
  Trash2,
  ShieldCheck,
  TrendingUp,
  Globe,
} from 'lucide-react';
import { Target, DisplayStatus } from '../../types';
import { formatUtc } from '../format';

interface ServerCardProps {
  server: Target;
  latencyThresholdMs: number;
  onProbeNow: (id: string) => Promise<void>;
  onSelectForChart: (server: Target) => void;
  onDeleteServer: (id: string) => Promise<void>;
  isProbing: boolean;
}

const STATUS_STYLE: Record<DisplayStatus, { border: string; bar: string; badge: string; dot: string; label: string }> = {
  online: { border: 'border-emerald-500/30', bar: 'bg-emerald-500/80', badge: 'bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400 animate-pulse', label: 'ONLINE' },
  degraded: { border: 'border-amber-500/30', bar: 'bg-amber-500/80', badge: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400 animate-pulse', label: 'DEGRADED' },
  offline: { border: 'border-rose-500/30', bar: 'bg-rose-500/80', badge: 'bg-rose-500/10 text-rose-400', dot: 'bg-rose-400', label: 'OFFLINE' },
  unknown: { border: 'border-slate-700', bar: 'bg-slate-600', badge: 'bg-slate-700/40 text-slate-300', dot: 'bg-slate-400', label: 'AWAITING PROBE' },
};

const fmt = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

const UptimeBox: React.FC<{ label: string; value: number | null | undefined }> = ({ label, value }) => {
  const color = value == null ? 'text-slate-400' : value >= 99 ? 'text-emerald-400' : value >= 95 ? 'text-amber-400' : 'text-rose-400';
  const bar = value == null ? 'bg-slate-600' : value >= 99 ? 'bg-emerald-500' : value >= 95 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 text-center">
      <span className="text-[10px] text-slate-400 block uppercase font-medium">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>{fmt(value, '%')}</span>
      <div className="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
        <div className={`${bar} h-full rounded-full transition-all`} style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
};

const NotAvailable: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/60">
    <div className="flex items-center space-x-1 text-[11px] text-slate-400">
      {icon}
      <span>{label}</span>
    </div>
    <p className="text-[11px] font-medium text-slate-300 mt-1">Not available</p>
    <span className="text-[9px] text-slate-500 block">Requires internal metrics</span>
  </div>
);

export const ServerCard: React.FC<ServerCardProps> = ({
  server,
  latencyThresholdMs,
  onProbeNow,
  onSelectForChart,
  onDeleteServer,
  isProbing,
}) => {
  const status: DisplayStatus = server.current_status ?? 'unknown';
  const style = STATUS_STYLE[status];
  const isHighLatency = typeof server.last_latency_ms === 'number' && server.last_latency_ms >= latencyThresholdMs;
  const isDefaultPort = (server.protocol === 'http' && server.port === 80) || (server.protocol === 'https' && server.port === 443);
  const url = `${server.protocol}://${server.host}${isDefaultPort ? '' : `:${server.port}`}${server.path}`;

  return (
    <div className={`bg-[#111726] border ${style.border} rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col relative overflow-hidden`}>
      <div className={`absolute top-0 left-0 right-0 h-1 ${style.bar}`} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <h2 className="text-base sm:text-lg font-bold text-white truncate">{server.name}</h2>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wider ${style.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${style.dot}`} />
              {style.label}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1 font-mono">
            <span className="text-slate-300 truncate">{server.host}:{server.port}</span>
            <span className="px-1.5 rounded bg-slate-800 text-[10px] text-slate-300 uppercase font-semibold">{server.protocol}</span>
            <a href={url} target="_blank" rel="noreferrer noopener" className="hover:text-orange-400" title={url}>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            onClick={() => onProbeNow(server.id)}
            disabled={isProbing}
            title="Run an HTTP probe now from Cloudflare's edge"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50 text-xs flex items-center space-x-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${isProbing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Probe</span>
          </button>
          <button
            onClick={() => onDeleteServer(server.id)}
            title="Stop monitoring this VPS"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live telemetry */}
      <div className="grid grid-cols-3 gap-2.5 py-3 px-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 mb-5">
        <div>
          <div className="flex items-center space-x-1 text-[11px] text-slate-400">
            <Activity className="w-3 h-3 text-orange-400" />
            <span>HTTP Latency</span>
          </div>
          <div className="flex items-baseline space-x-1 mt-1">
            <span className="text-xl font-bold font-mono text-white">{fmt(server.last_latency_ms)}</span>
            <span className="text-xs text-slate-400 font-mono">ms</span>
            {isHighLatency && <span className="ml-1 text-[10px] text-amber-400 font-medium bg-amber-500/20 px-1 rounded">HIGH</span>}
          </div>
        </div>
        <div>
          <div className="flex items-center space-x-1 text-[11px] text-slate-400">
            <ShieldCheck className="w-3 h-3 text-sky-400" />
            <span>HTTP Status</span>
          </div>
          <div className="mt-1">
            <span
              className={`text-xl font-bold font-mono ${
                server.last_status_code == null
                  ? 'text-slate-400'
                  : server.last_status_code < 400
                  ? 'text-emerald-400'
                  : server.last_status_code < 500
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {server.last_checked_at ? server.last_status_code ?? 'No resp.' : '—'}
            </span>
          </div>
        </div>
        <div>
          <div className="flex items-center space-x-1 text-[11px] text-slate-400">
            <Globe className="w-3 h-3 text-indigo-400" />
            <span>Probed from</span>
          </div>
          <div className="mt-1">
            <span className="text-base font-bold font-mono text-indigo-300">{server.last_colo ?? '—'}</span>
            <span className="text-[10px] text-slate-500 block">Cloudflare PoP</span>
          </div>
        </div>
      </div>

      {/* Latency stats */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-medium">HTTP latency, last 24h ({server.checks_24h ?? 0} checks)</span>
          <button onClick={() => onSelectForChart(server)} className="text-orange-400 hover:text-orange-300 flex items-center space-x-1">
            <TrendingUp className="w-3 h-3" />
            <span>Chart</span>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/60 text-center font-mono text-xs">
          <div>
            <span className="text-[10px] text-slate-400 block uppercase">Min</span>
            <span className="text-emerald-400 font-semibold">{fmt(server.min_latency_24h, ' ms')}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase">Avg</span>
            <span className="text-orange-400 font-semibold">{fmt(server.avg_latency_24h, ' ms')}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase">Max</span>
            <span className="text-amber-400 font-semibold">{fmt(server.max_latency_24h, ' ms')}</span>
          </div>
        </div>
      </div>

      {/* Uptime */}
      <div className="mb-5">
        <div className="text-xs font-medium text-slate-300 mb-2">Uptime</div>
        <div className="grid grid-cols-3 gap-2">
          <UptimeBox label="24 Hours" value={server.uptime_24h} />
          <UptimeBox label="7 Days" value={server.uptime_7d} />
          <UptimeBox label="30 Days" value={server.uptime_30d} />
        </div>
      </div>

      {/* Internal metrics: honest "not available" (zero-agent) */}
      <div className="border-t border-slate-800/80 pt-4">
        <div className="text-xs text-slate-400 mb-2 font-medium">
          Internal system metrics <span className="px-1.5 rounded bg-slate-800 text-[10px] font-normal">zero-agent</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NotAvailable icon={<Cpu className="w-3 h-3 text-slate-500" />} label="CPU" />
          <NotAvailable icon={<Layers className="w-3 h-3 text-slate-500" />} label="RAM" />
          <NotAvailable icon={<HardDrive className="w-3 h-3 text-slate-500" />} label="Disk" />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 px-1 gap-2">
          <span className="flex items-center space-x-1">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>Network: external HTTP reachability</span>
          </span>
          <span className="font-mono">{server.last_checked_at ? formatUtc(server.last_checked_at) : 'Awaiting first probe'}</span>
        </div>
      </div>

      {server.last_error && status !== 'online' && (
        <div className="mt-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="break-words">{server.last_error}</span>
        </div>
      )}
    </div>
  );
};
