import React, { useState, useEffect, useCallback } from 'react';
import { Incident, PaginationMeta } from '../../types';
import { CheckCircle2, ShieldAlert, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total_records: 0,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIncidents = useCallback(async (page = pagination.page, limit = pagination.limit) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: Incident[]; pagination: PaginationMeta }>(
        `/api/incidents?page=${page}&limit=${limit}`
      );
      setIncidents(res.data || []);
      if (res.pagination) {
        setPagination(res.pagination);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load incidents');
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.limit]);

  useEffect(() => {
    loadIncidents(1, pagination.limit);
  }, []);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.total_pages) return;
    loadIncidents(newPage, pagination.limit);
  };

  const handleLimitChange = (newLimit: number) => {
    loadIncidents(1, newLimit);
  };

  const startRecord = pagination.total_records === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endRecord = Math.min(pagination.total_records, pagination.page * pagination.limit);

  return (
    <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <span>Downtime &amp; Incident History</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatic tracking of downtime events with server-side pagination.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Page size selector */}
          <div className="flex items-center space-x-1.5 text-xs text-slate-400">
            <span>Show:</span>
            <select
              value={pagination.limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-orange-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          <button
            onClick={() => loadIncidents(pagination.page, pagination.limit)}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="py-8 text-center text-rose-400 text-sm">{error}</div>
      ) : isLoading ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-2" />
          Loading incident records…
        </div>
      ) : incidents.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400/80 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-200">No Incidents Recorded</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            All monitored VPS nodes are operational. Downtime detected by external Cloudflare probes will be recorded here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="pb-3 px-3">Node</th>
                  <th className="pb-3 px-3">Started</th>
                  <th className="pb-3 px-3">Resolved</th>
                  <th className="pb-3 px-3">Duration</th>
                  <th className="pb-3 px-3">Cause / Root Error</th>
                  <th className="pb-3 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {incidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-900/40">
                    <td className="py-3 px-3 font-sans font-semibold text-white whitespace-nowrap">
                      {inc.target_name || inc.target_id}
                    </td>
                    <td className="py-3 px-3 text-slate-300 whitespace-nowrap">
                      {formatUtc(inc.start_time)}
                    </td>
                    <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                      {formatUtc(inc.end_time)}
                    </td>
                    <td className="py-3 px-3 text-orange-400 font-semibold whitespace-nowrap">
                      {formatDuration(inc)}
                    </td>
                    <td className="py-3 px-3 text-slate-300 max-w-xs truncate" title={inc.cause}>
                      {inc.cause}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {inc.status === 'resolved' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          RESOLVED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
                          ONGOING
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="mt-5 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3">
            <div>
              Showing <strong className="text-white">{startRecord}</strong> to{' '}
              <strong className="text-white">{endRecord}</strong> of{' '}
              <strong className="text-white">{pagination.total_records}</strong> incidents
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.has_prev}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: pagination.total_pages }, (_, i) => i + 1)
                .slice(Math.max(0, pagination.page - 3), Math.min(pagination.total_pages, pagination.page + 2))
                .map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-3 py-1 rounded-lg font-mono text-xs transition ${
                      pagination.page === pageNum
                        ? 'bg-orange-500 text-white font-bold shadow-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}

              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.has_next}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
};
