import React from 'react';
import { Cloud, Activity, RefreshCw, Plus, ShieldCheck, Lock, Globe } from 'lucide-react';
import { DashboardOverview } from '../../types';

interface NavbarProps {
  overview: DashboardOverview | null;
  isLoading: boolean;
  onRefreshAll: () => void;
  onOpenAddModal: () => void;
  autoRefreshInterval: number;
  setAutoRefreshInterval: (interval: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  overview,
  isLoading,
  onRefreshAll,
  onOpenAddModal,
  autoRefreshInterval,
  setAutoRefreshInterval,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#0E1322]/90 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left: Branding & Architecture Badge */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/20 ring-1 ring-orange-400/30">
            <Cloud className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Cloudflare VPS Monitor
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Zero-Agent
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              External Edge Probes via Cloudflare Workers & D1
            </p>
          </div>
        </div>

        {/* Right: Edge Colo Badge, Cloudflare Access Status & Actions */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          
          {/* Edge Colocation Location */}
          {overview?.edge_location && (
            <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
              <Globe className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-mono font-medium text-orange-400">{overview.edge_location.colo}</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400">{overview.edge_location.city || overview.edge_location.country}</span>
            </div>
          )}

          {/* Cloudflare Access Protection Indicator */}
          <div className="hidden lg:flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-blue-950/40 border border-blue-800/40 text-xs text-blue-300">
            <Lock className="w-3 h-3 text-blue-400" />
            <span>CF Access</span>
          </div>

          {/* Auto Refresh Selector */}
          <div className="flex items-center space-x-1 text-xs">
            <label className="text-slate-400 hidden sm:inline">Refresh:</label>
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500 outline-none"
            >
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1m</option>
              <option value={0}>Manual</option>
            </select>
          </div>

          {/* Refresh All Button */}
          <button
            onClick={onRefreshAll}
            disabled={isLoading}
            title="Trigger instant edge probe across all targets"
            className="p-2 sm:px-3 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition flex items-center space-x-1.5 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Probe Now</span>
          </button>

          {/* Add VPS Button */}
          <button
            onClick={onOpenAddModal}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-xs shadow-md shadow-orange-500/20 flex items-center space-x-1.5 transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add VPS</span>
          </button>

        </div>
      </div>
    </header>
  );
};
