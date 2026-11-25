import React, { useState } from 'react';
import { Cloud, ShieldCheck, KeyRound, ArrowRight, Eye, EyeOff, Sparkles, Globe } from 'lucide-react';

interface SetupScreenProps {
  onSetupSuccess: () => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess }) => {
  const [appTitle, setAppTitle] = useState('VPS Monitoring Dashboard');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          app_title: appTitle.trim() || 'VPS Monitoring Dashboard',
          password,
          github_url: githubUrl.trim(),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as any;

      if (!res.ok || body.success === false) {
        setError(body.error || 'Failed to complete setup');
        return;
      }

      onSetupSuccess();
    } catch (err: any) {
      setError(err.message || 'Connection error during setup');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center p-4 selection:bg-orange-500 selection:text-white">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-600/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-lg bg-[#111726]/90 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10">
        
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 mx-auto flex items-center justify-center shadow-lg shadow-orange-500/25 ring-1 ring-orange-400/40 mb-3">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Initial Dashboard Setup
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Configure your administrator credentials and dynamic settings
          </p>
        </div>

        <div className="mb-6 p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center space-x-2.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="leading-tight">
            Zero hardcoded credentials. All configuration is cryptographically hashed and saved directly into Cloudflare D1.
          </span>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          <div>
            <label className="block font-medium text-slate-300 mb-1">Dashboard Brand Title</label>
            <input
              type="text"
              required
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              placeholder="e.g. Production VPS Monitor"
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 outline-none focus:border-orange-500 transition text-sm"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span>Admin Password (min. 8 characters)</span>
              <span className="text-[10px] text-slate-500">SHA-256 Hashed</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong admin password"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl pl-3.5 pr-10 py-2.5 outline-none focus:border-orange-500 font-mono transition text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1">Confirm Admin Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter admin password"
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 outline-none focus:border-orange-500 font-mono transition text-sm"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1">Optional GitHub Repository URL</label>
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/your-username/your-repo"
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 outline-none focus:border-orange-500 font-mono transition text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-sm shadow-lg shadow-orange-500/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 active:scale-[0.99] mt-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Complete Setup &amp; Open Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

        </form>

      </div>
    </div>
  );
};
