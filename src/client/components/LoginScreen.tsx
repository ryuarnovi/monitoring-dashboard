import React, { useState } from 'react';
import { Cloud, Lock, ShieldCheck, KeyRound, AlertTriangle, ArrowRight, Eye, EyeOff } from 'lucide-react';

interface LoginScreenProps {
  appTitle?: string;
  onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ appTitle = 'VPS Monitoring Dashboard', onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Password is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });

      const body = (await res.json().catch(() => ({}))) as any;

      if (res.status === 429) {
        setRetryAfter(body.retry_after || 60);
        setError(body.error || 'Too many attempts. Throttling active.');
        return;
      }

      if (!res.ok || body.success === false) {
        setError(body.error || 'Invalid password. Access denied.');
        return;
      }

      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Connection error. Could not authenticate.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center p-4 selection:bg-orange-500 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-600/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md bg-[#111726]/90 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10">
        
        {/* Header Branding */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 mx-auto flex items-center justify-center shadow-lg shadow-orange-500/25 ring-1 ring-orange-400/40 mb-3">
            <Cloud className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            {appTitle}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Zero-Agent Edge Infrastructure Dashboard
          </p>
        </div>

        {/* Security Badge */}
        <div className="mb-6 p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center space-x-2.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="leading-tight">
            Anti-bypass security active. Multi-layer access control and brute-force throttling enabled.
          </span>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{error}</p>
              {retryAfter && (
                <p className="text-[11px] text-rose-400/80 mt-1">
                  Brute-force protection: please wait {retryAfter}s.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Admin Access Password</span>
              <span className="text-[10px] text-slate-500">HMAC-SHA256 Session</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                placeholder="Enter dashboard password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-700 text-white rounded-xl pl-3.5 pr-10 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 font-mono transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-sm shadow-lg shadow-orange-500/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 active:scale-[0.99]"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500 space-y-1">
          <p>Protected by Cloudflare Edge &amp; D1 SQLite</p>
          <p className="text-slate-600">Zero-Agent External Probes</p>
        </div>

      </div>
    </div>
  );
};
