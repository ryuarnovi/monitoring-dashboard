import React from 'react';
import { 
  ShieldCheck, 
  Cloud, 
  Cpu, 
  Database, 
  Lock, 
  Terminal, 
  ExternalLink, 
  CheckCircle2, 
  Layers, 
  Globe, 
  Zap,
  Server
} from 'lucide-react';

export const ArchitectureGuide: React.FC = () => {
  return (
    <div className="space-y-6">
      
      {/* Zero Agent Philosophy Banner */}
      <div className="bg-gradient-to-r from-orange-950/40 via-[#111726] to-[#111726] border border-orange-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>100% Zero-Agent Architecture</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              External Edge Probes via Cloudflare Global Network
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Monitored VPS nodes run purely on their own workload. No monitoring daemons, exporters, agents, or SSH keys are ever installed on the target machine. All uptime, reachability, and response times are measured externally from Cloudflare Workers edge nodes.
            </p>
          </div>
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center shrink-0">
            <span className="text-3xl font-extrabold text-emerald-400 font-mono">0%</span>
            <span className="text-xs font-medium text-slate-300 mt-1">Host Resource Overhead</span>
            <span className="text-[10px] text-slate-400">Zero footprint on monitored VPS</span>
          </div>
        </div>
      </div>

      {/* Architecture Building Blocks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Block 1: Cloudflare Cron & Workers */}
        <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-5 hover:border-slate-700 transition">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center mb-4">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white mb-2">Cloudflare Cron Triggers</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Cron triggers fire every 1–2 minutes across Cloudflare’s worldwide edge. Workers execute non-intrusive HTTP/HTTPS probes concurrently, measuring true user-facing latency and status.
          </p>
        </div>

        {/* Block 2: Cloudflare D1 Database */}
        <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-5 hover:border-slate-700 transition">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mb-4">
            <Database className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white mb-2">Cloudflare D1 Storage</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Zero-latency edge SQLite database stores target configs, time-series latency points, 24h/7d/30d uptime calculations, and downtime incident logs with automated recovery detection.
          </p>
        </div>

        {/* Block 3: Cloudflare Zero Trust Access */}
        <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-5 hover:border-slate-700 transition">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white mb-2">Cloudflare Access Security</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Protect <code className="text-orange-400 font-mono">monitor.DOMAIN.COM</code> using Cloudflare Zero Trust Access. Only authorized team emails or SSO can reach the dashboard, eliminating attack surfaces.
          </p>
        </div>

      </div>

      {/* Why CPU / RAM / Disk are "Not Available" */}
      <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-6">
        <div className="flex items-start space-x-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-white">
              Why CPU, RAM, and Disk metrics are marked &ldquo;Not Available&rdquo;
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              In accordance with the <strong>Zero-Agent Architecture</strong> specification, this dashboard strictly forbids mock or estimated internal metrics. Obtaining CPU percentage, memory allocation, or disk utilization requires either an in-guest daemon (e.g. Node Exporter), an SSH connection, or an exposed metrics daemon.
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              By remaining 100% external, your VPS remains completely untampered, impervious to agent-level exploits, and free of background telemetry consumption.
            </p>
          </div>
        </div>
      </div>

      {/* Deployment & Setup Checklist */}
      <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-6">
        <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
          <Terminal className="w-5 h-5 text-orange-400" />
          <span>Production Deployment Steps (Cloudflare CLI)</span>
        </h3>

        <div className="space-y-4 text-xs font-mono">
          
          {/* Step 1 */}
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-2 text-slate-300 font-sans font-medium mb-1.5">
              <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold font-mono">1</span>
              <span>Create Cloudflare D1 Database</span>
            </div>
            <pre className="text-orange-300 bg-black/40 p-2.5 rounded-lg overflow-x-auto">
              npx wrangler d1 create vps_monitor_db
            </pre>
            <p className="text-slate-400 font-sans text-[11px] mt-1">
              Copy the generated <code className="text-orange-400">database_id</code> into <code className="text-orange-400">wrangler.jsonc</code>.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-2 text-slate-300 font-sans font-medium mb-1.5">
              <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold font-mono">2</span>
              <span>Apply D1 Database Schema Migration</span>
            </div>
            <pre className="text-orange-300 bg-black/40 p-2.5 rounded-lg overflow-x-auto">
              npx wrangler d1 execute vps_monitor_db --remote --file=./migrations/0001_initial_schema.sql
            </pre>
          </div>

          {/* Step 3 */}
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-2 text-slate-300 font-sans font-medium mb-1.5">
              <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold font-mono">3</span>
              <span>Build Frontend SPA &amp; Deploy Worker</span>
            </div>
            <pre className="text-orange-300 bg-black/40 p-2.5 rounded-lg overflow-x-auto">
              npm run build &amp;&amp; npx wrangler deploy
            </pre>
          </div>

          {/* Step 4 */}
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-2 text-slate-300 font-sans font-medium mb-1.5">
              <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold font-mono">4</span>
              <span>Bind Custom Subdomain (monitor.DOMAIN.COM)</span>
            </div>
            <p className="text-slate-300 font-sans text-xs">
              In Cloudflare Dashboard &rarr; <strong>Workers &amp; Pages</strong> &rarr; <code className="text-orange-400">cloudflare-vps-monitoring</code> &rarr; <strong>Settings &rarr; Domains &amp; Routes</strong> &rarr; Click <strong>Add &rarr; Custom Domain</strong> &rarr; Enter <code className="text-orange-400">monitor.DOMAIN.COM</code>.
            </p>
          </div>

          {/* Step 5 */}
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-2 text-slate-300 font-sans font-medium mb-1.5">
              <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold font-mono">5</span>
              <span>Enable Cloudflare Zero Trust Access</span>
            </div>
            <p className="text-slate-300 font-sans text-xs">
              Go to <strong>Zero Trust</strong> &rarr; <strong>Access</strong> &rarr; <strong>Applications</strong> &rarr; Add <code className="text-orange-400">monitor.DOMAIN.COM</code> &rarr; Configure an allow-list policy with your email or One-Time Pin.
            </p>
          </div>

        </div>
      </div>

    </div>
  );
};
