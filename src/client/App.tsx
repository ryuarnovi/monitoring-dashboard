import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Target, DashboardOverview } from '../types';
import { Navbar } from './components/Navbar';
import { SummaryCards } from './components/SummaryCards';
import { ServerCard } from './components/ServerCard';
import { IncidentHistory } from './components/IncidentHistory';
import { AddServerModal } from './components/AddServerModal';
import { ArchitectureGuide } from './components/ArchitectureGuide';
import { apiFetch } from './format';
import { Server, ShieldAlert, Terminal, Plus, CheckCircle2, ExternalLink, Info, Lock } from 'lucide-react';

// Recharts is heavy; only load it when the user opens the latency chart.
const LatencyChart = lazy(async () => {
  const m = await import('./components/LatencyChart');
  return { default: m.LatencyChart };
});

type Tab = 'servers' | 'incidents' | 'architecture';
type Toast = { message: string; type: 'success' | 'info' | 'error' };

export const App: React.FC = () => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [servers, setServers] = useState<Target[]>([]);
  const [chartServer, setChartServer] = useState<Target | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('servers');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isProbingAll, setIsProbingAll] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [refreshMs, setRefreshMs] = useState(30000);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = (message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([
        apiFetch<{ data: DashboardOverview }>('/api/overview'),
        apiFetch<{ data: Target[] }>('/api/targets'),
      ]);
      setOverview(o.data);
      setServers(t.data || []);
      setLoadError(null);
    } catch (e: any) {
      // Never substitute mock data: show the real error instead.
      setLoadError(e.message || 'Unable to reach the monitoring API');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, fetchData]);

  const handleProbeNow = async (id: string) => {
    setProbingId(id);
    try {
      const r = await apiFetch<{ data: { status: string; response_time_ms: number | null; status_code: number | null } }>(
        `/api/targets/${id}/probe`,
        { method: 'POST' }
      );
      const d = r.data;
      notify(
        `Probe: ${d.status.toUpperCase()} — ${d.status_code ? `HTTP ${d.status_code}` : 'no response'}${d.response_time_ms != null ? `, ${d.response_time_ms} ms` : ''}`,
        d.status === 'online' ? 'success' : 'error'
      );
      await fetchData();
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setProbingId(null);
    }
  };

  const handleProbeAll = async () => {
    setIsProbingAll(true);
    try {
      const r = await apiFetch<{ scanned_count: number }>('/api/probes/run-all', { method: 'POST' });
      notify(`Probed ${r.scanned_count} target(s)`, 'success');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      await fetchData();
      setIsProbingAll(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this VPS and all of its monitoring history?')) return;
    try {
      await apiFetch(`/api/targets/${id}`, { method: 'DELETE' });
      notify('Target removed', 'info');
      await fetchData();
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const threshold = overview?.latency_threshold_ms ?? 1000;

  const tabBtn = (id: Tab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`pb-3 px-2 sm:px-3 text-xs sm:text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
        tab === id ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col font-sans">
      <Navbar
        overview={overview}
        isLoading={isProbingAll}
        onRefreshAll={handleProbeAll}
        onOpenAddModal={() => setIsAddOpen(true)}
        autoRefreshInterval={refreshMs}
        setAutoRefreshInterval={setRefreshMs}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border text-xs font-medium flex items-center space-x-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
              : toast.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-500/40'
              : 'bg-slate-900/90 text-slate-200 border-slate-700'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-orange-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loadError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-start space-x-3">
            <Lock className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Cannot load monitoring data</p>
              <p className="text-xs text-rose-300/90 mt-1 break-words">{loadError}</p>
            </div>
          </div>
        )}

        <SummaryCards overview={overview} />

        <div className="flex items-center justify-between border-b border-slate-800/80 mb-6 overflow-x-auto">
          <div className="flex space-x-1 sm:space-x-3">
            {tabBtn('servers', <Server className="w-4 h-4" />, `Nodes (${servers.length})`)}
            {tabBtn('incidents', <ShieldAlert className="w-4 h-4" />, 'Incidents')}
            {tabBtn('architecture', <Terminal className="w-4 h-4" />, 'Setup Guide')}
          </div>
          {overview?.access_user && (
            <span className="hidden md:inline text-xs text-slate-400 pb-3">Signed in as {overview.access_user}</span>
          )}
        </div>

        {tab === 'servers' &&
          (isLoading ? (
            <div className="py-24 text-center text-slate-500">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500 mx-auto mb-3" />
              <p className="text-sm">Loading…</p>
            </div>
          ) : servers.length === 0 && !loadError ? (
            <div className="py-20 text-center bg-[#111726] border border-slate-800 rounded-2xl p-8">
              <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white">No VPS configured</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
                Add a VPS (hostname or IP + port of a web service it already runs). Nothing is installed on the server.
              </p>
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium text-xs inline-flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add VPS</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {servers.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  latencyThresholdMs={threshold}
                  onProbeNow={handleProbeNow}
                  onSelectForChart={setChartServer}
                  onDeleteServer={handleDelete}
                  isProbing={probingId === s.id}
                />
              ))}
            </div>
          ))}

        {tab === 'incidents' && <IncidentHistory />}
        {tab === 'architecture' && <ArchitectureGuide />}
      </main>

      {chartServer && (
        <Suspense fallback={null}>
          <LatencyChart server={chartServer} latencyThresholdMs={threshold} onClose={() => setChartServer(null)} />
        </Suspense>
      )}

      <AddServerModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onServerAdded={() => {
          notify('VPS added and probed', 'success');
          fetchData();
        }}
      />

      <footer className="mt-auto border-t border-slate-800/80 bg-[#0E1322] py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <span>
            <span className="font-semibold text-slate-300">Cloudflare VPS Monitor</span> · zero-agent external monitoring
          </span>
          <a
            href="https://github.com/ryuarnovi/monitoring-dashboard"
            target="_blank"
            rel="noreferrer noopener"
            className="text-orange-400 hover:underline flex items-center space-x-1"
          >
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </footer>
    </div>
  );
};

export default App;
