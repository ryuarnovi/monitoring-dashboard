import React, { useState, useEffect, useCallback } from 'react';
import { Incident } from '../../types';
import { CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react';
import { apiFetch, formatUtc, parseUtc } from '../format';

const formatDuration = (inc: Incident) => {
  const seconds =
    inc.duration_seconds ?? Math.max(0, Math.round((Date.now() - parseUtc(inc.start_time).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

export const IncidentHistory: React.FC = () => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ data: Incident[] }>('/api/incidents?limit=100');
      setIncidents(r.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <span>Downtime &amp; Incident History</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Opened automatically when a probe fails or degrades; closed on the next healthy probe.</p>
        </div>
        <button onClick={load} disabled={isLoading} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1">
          <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error ? (
        <div className="py-8 text-center text-rose-400 text-sm">{error}</div>
      ) : isLoading ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-2" />
          Loading…
        </div>
      ) : incidents.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400/80 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-200">No incidents recorded</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="pb-3 px-3">Node</th>
                <th className="pb-3 px-3">Started</th>
                <th className="pb-3 px-3">Resolved</th>
                <th className="pb-3 px-3">Duration</th>
                <th className="pb-3 px-3">Cause</th>
                <th className="pb-3 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {incidents.map((inc) => (
                <tr key={inc.id} className="hover:bg-slate-900/40">
                  <td className="py-3 px-3 font-sans font-semibold text-white whitespace-nowrap">{inc.target_name || inc.target_id}</td>
                  <td className="py-3 px-3 text-slate-300 whitespace-nowrap">{formatUtc(inc.start_time)}</td>
                  <td className="py-3 px-3 text-slate-400 whitespace-nowrap">{formatUtc(inc.end_time)}</td>
                  <td className="py-3 px-3 text-orange-400 font-semibold whitespace-nowrap">{formatDuration(inc)}</td>
                  <td className="py-3 px-3 text-slate-300 max-w-xs truncate" title={inc.cause}>{inc.cause}</td>
                  <td className="py-3 px-3 text-right">
                    {inc.status === 'resolved' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">RESOLVED</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">ONGOING</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
