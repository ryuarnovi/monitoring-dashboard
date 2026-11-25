import React, { useState, useEffect } from 'react';
import { X, Server, Edit3, Save } from 'lucide-react';
import { Target } from '../../types';
import { apiFetch } from '../format';

interface EditServerModalProps {
  server: Target | null;
  isOpen: boolean;
  onClose: () => void;
  onServerUpdated: () => void;
}

export const EditServerModal: React.FC<EditServerModalProps> = ({
  server,
  isOpen,
  onClose,
  onServerUpdated,
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [port, setPort] = useState<number>(80);
  const [path, setPath] = useState('/');
  const [expectedStatus, setExpectedStatus] = useState<number>(200);
  const [timeoutMs, setTimeoutMs] = useState<number>(5000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (server) {
      setName(server.name);
      setHost(server.host);
      setProtocol(server.protocol);
      setPort(server.port);
      setPath(server.path || '/');
      setExpectedStatus(server.expected_status || 200);
      setTimeoutMs(server.timeout_ms || 5000);
      setError(null);
    }
  }, [server]);

  if (!isOpen || !server) return null;

  const handleProtocolChange = (newProtocol: 'http' | 'https') => {
    setProtocol(newProtocol);
    if (newProtocol === 'https' && port === 80) {
      setPort(443);
    } else if (newProtocol === 'http' && port === 443) {
      setPort(80);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !host.trim()) {
      setError('Server name and host are required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await apiFetch(`/api/targets/${server.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          host: host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
          protocol,
          port,
          path: path.trim() || '/',
          expected_status: expectedStatus,
          timeout_ms: timeoutMs,
        }),
      });

      onServerUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update target');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111726] border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 text-orange-400 flex items-center justify-center">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Edit Monitored VPS</h2>
              <p className="text-xs text-slate-400">Update probe configuration for {server.name}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          
          <div>
            <label className="block text-slate-300 font-medium mb-1">Server Display Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 transition"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Hostname or IP Address</label>
              <input
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-orange-500 transition"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Port</label>
              <input
                type="number"
                required
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-orange-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Protocol</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleProtocolChange('http')}
                  className={`py-2 rounded-lg font-mono font-semibold transition border ${
                    protocol === 'http' 
                      ? 'bg-orange-500/20 border-orange-500 text-orange-400' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  onClick={() => handleProtocolChange('https')}
                  className={`py-2 rounded-lg font-mono font-semibold transition border ${
                    protocol === 'https' 
                      ? 'bg-orange-500/20 border-orange-500 text-orange-400' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  HTTPS
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Health Path</label>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/ or /health"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-orange-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Expected HTTP Code</label>
              <input
                type="number"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(Number(e.target.value))}
                placeholder="200"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-orange-500 transition"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Standard 301/302 redirects are also treated as healthy.
              </span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Timeout (ms)</label>
              <input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                placeholder="5000"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-orange-500 transition"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium shadow-md shadow-orange-500/20 flex items-center space-x-1.5 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving Changes...' : 'Save & Re-Probe'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
