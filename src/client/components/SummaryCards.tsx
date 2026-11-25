import React from 'react';
import { Server, AlertTriangle, XCircle, Activity, Clock, HelpCircle } from 'lucide-react';
import { DashboardOverview } from '../../types';

interface SummaryCardsProps {
  overview: DashboardOverview | null;
}

const Card: React.FC<{ label: string; icon: React.ReactNode; value: React.ReactNode; unit?: string; labelClass?: string }> = ({
  label,
  icon,
  value,
  unit,
  labelClass = 'text-slate-400',
}) => (
  <div className="bg-[#111726] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition">
    <div className="flex items-center justify-between mb-2">
      <span className={`text-xs font-medium uppercase tracking-wider ${labelClass}`}>{label}</span>
      {icon}
    </div>
    <div className="flex items-baseline space-x-1">
      <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
      {unit && <span className="text-xs text-slate-400">{unit}</span>}
    </div>
  </div>
);

export const SummaryCards: React.FC<SummaryCardsProps> = ({ overview }) => {
  const o = overview;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
      <Card
        label="Total VPS"
        icon={<Server className="w-4 h-4 text-slate-400" />}
        value={o?.total_targets ?? '—'}
        unit={o?.unknown_count ? `${o.unknown_count} awaiting probe` : 'nodes'}
      />
      <Card
        label="Online"
        labelClass="text-emerald-400"
        icon={<div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
        value={<span className="text-emerald-400">{o?.online_count ?? '—'}</span>}
        unit="healthy"
      />
      <Card
        label="Degraded"
        labelClass="text-amber-400"
        icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
        value={<span className={o?.degraded_count ? 'text-amber-400' : 'text-slate-400'}>{o?.degraded_count ?? '—'}</span>}
        unit="slow / unexpected"
      />
      <Card
        label="Offline"
        labelClass="text-rose-400"
        icon={<XCircle className="w-4 h-4 text-rose-400" />}
        value={<span className={o?.offline_count ? 'text-rose-400' : 'text-slate-400'}>{o?.offline_count ?? '—'}</span>}
        unit="down"
      />
      <Card
        label="24h Uptime"
        icon={<Clock className="w-4 h-4 text-sky-400" />}
        value={o?.overall_uptime_24h != null ? `${o.overall_uptime_24h}%` : '—'}
        unit={o?.overall_uptime_24h == null ? 'no data yet' : undefined}
      />
      <Card
        label="HTTP Latency"
        icon={o ? <Activity className="w-4 h-4 text-orange-400" /> : <HelpCircle className="w-4 h-4 text-slate-500" />}
        value={<span className="text-orange-400">{o?.avg_latency_ms ?? '—'}</span>}
        unit="ms avg (not ICMP)"
      />
    </div>
  );
};
