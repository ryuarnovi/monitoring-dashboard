import React, { useState, useEffect } from 'react';
import { Sliders, Save, CheckCircle2, ShieldAlert, KeyRound, Globe, Database, Terminal } from 'lucide-react';
import { SystemSettings } from '../../types';
import { apiFetch } from '../format';

interface SettingsTabProps {
  onSettingsSaved: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ onSettingsSaved }) => {
  const [appTitle, setAppTitle] = useState('');
  const [latencyThreshold, setLatencyThreshold] = useState<number>(1000);
  const [githubUrl, setGithubUrl] = useState('');
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [customUserAgent, setCustomUserAgent] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch<{ data: SystemSettings }>('/api/system/settings');
      if (res.data) {
        setAppTitle(res.data.app_title || 'VPS Monitoring Dashboard');
        setLatencyThreshold(res.data.latency_threshold_ms || 1000);
        setGithubUrl(res.data.github_url || '');
        setRetentionDays(res.data.retention_days || 30);
        setCustomUserAgent(res.data.custom_user_agent || '');
      }
    } catch (e: any) {
      setMessage({ text: e.message || 'Failed to load settings', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword && newPassword.length < 8) {
      setMessage({ text: 'New password must be at least 8 characters', type: 'error' });
      return;
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      setMessage({ text: 'Passwords do not match', type: 'error' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const payload: any = {
        app_title: appTitle.trim(),
        latency_threshold_ms: latencyThreshold,
        github_url: githubUrl.trim(),
        retention_days: retentionDays,
        custom_user_agent: customUserAgent.trim(),
      };

      if (newPassword) {
        payload.new_admin_password = newPassword;
      }

      await apiFetch('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setMessage({ text: 'Settings updated successfully!', type: 'success' });
      setNewPassword('');
      setConfirmNewPassword('');
      onSettingsSaved();
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed to save settings', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center text-slate-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-2" />
        Loading system configuration...
      </div>
    );
  }

  return (
    <div className="bg-[#111726] border border-slate-800/90 rounded-2xl p-6 shadow-xl max-w-4xl mx-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-5 border-b border-slate-800 mb-6">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-orange-400" />
            <span>Dynamic System Settings</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Modify dashboard title, thresholds, user agents, and security settings stored dynamically in Cloudflare D1.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-6 p-3.5 rounded-xl text-xs flex items-center space-x-2 border ${
            message.type === 'success'
              ? 'bg-emerald-950/60 text-emerald-200 border-emerald-500/30'
              : 'bg-rose-950/60 text-rose-200 border-rose-500/30'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 text-xs">
        
        {/* Section 1: Branding & Display */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5 text-orange-400" />
            <span>Branding &amp; Navigation</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Dashboard Title</label>
              <input
                type="text"
                required
                value={appTitle}
                onChange={(e) => setAppTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">GitHub Repository Link</label>
              <input
                type="url"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/..."
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Probing & Thresholds */}
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
            <Database className="w-3.5 h-3.5 text-sky-400" />
            <span>Edge Probing &amp; Retention</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                High Latency Threshold (ms)
              </label>
              <input
                type="number"
                min="100"
                max="10000"
                value={latencyThreshold}
                onChange={(e) => setLatencyThreshold(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Targets taking longer than this to respond are flagged as DEGRADED.
              </span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Data Retention (Days)
              </label>
              <input
                type="number"
                min="7"
                max="365"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Raw health check records older than this are automatically pruned.
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">
                Custom Probe HTTP User-Agent
              </label>
              <input
                type="text"
                value={customUserAgent}
                onChange={(e) => setCustomUserAgent(e.target.value)}
                placeholder="Cloudflare-ZeroAgent-Probe/1.0 (+https://your-domain.com)"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Change Password */}
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
            <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
            <span>Change Administrator Password</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep unchanged"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-xs shadow-md shadow-orange-500/20 flex items-center space-x-2 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving Changes...' : 'Save Settings'}</span>
          </button>
        </div>

      </form>

    </div>
  );
};
