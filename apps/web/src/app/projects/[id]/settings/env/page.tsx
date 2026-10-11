'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api-client';
import { SafeEnvironmentVariable } from '@deployforge/shared-types';

export default function EnvironmentVariablesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [variables, setVariables] = useState<SafeEnvironmentVariable[]>([]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [environment, setEnvironment] = useState('ALL');
  const [isSecret, setIsSecret] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchVariables();
  }, [resolvedParams.id]);

  const fetchVariables = async () => {
    try {
      const data = await apiRequest<SafeEnvironmentVariable[]>(`/projects/${resolvedParams.id}/env`);
      setVariables(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load environment variables');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await apiRequest(`/projects/${resolvedParams.id}/env`, {
        method: 'POST',
        body: JSON.stringify({
          key,
          value,
          environment,
          isSecret,
        }),
      });
      setKey('');
      setValue('');
      fetchVariables();
    } catch (err: any) {
      setError(err.message || 'Failed to add environment variable');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (varId: string) => {
    if (!confirm('Are you sure you want to delete this variable?')) return;
    try {
      await apiRequest(`/projects/${resolvedParams.id}/env/${varId}`, {
        method: 'DELETE',
      });
      fetchVariables();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Navigation */}
      <div className="flex items-center space-x-2 text-xs text-slate-400">
        <Link href={`/projects/${resolvedParams.id}`} className="hover:text-white transition">
          &larr; Back to Project
        </Link>
        <span>/</span>
        <span className="text-slate-200">Environment Variables</span>
      </div>

      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">Environment Variables</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure build-time and runtime environment variables. Secret values are encrypted at rest with AES-256-GCM and redacted from build logs.
        </p>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Add New Variable Form */}
      <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Add Variable</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Key Name (e.g. API_KEY)</label>
            <input
              type="text"
              required
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Value</label>
            <input
              type="text"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="secret_value_123"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Scope</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All Environments</option>
              <option value="PRODUCTION">Production Only</option>
              <option value="PREVIEW">Preview Only</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isSecret}
              onChange={(e) => setIsSecret(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-sky-500 focus:ring-0"
            />
            <span>Encrypt & Mask Secret (never returned to frontend)</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
          >
            {submitting ? 'Encrypting...' : 'Add Variable'}
          </button>
        </div>
      </form>

      {/* Variables List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider">Configured Variables</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm animate-pulse">Loading variables...</div>
        ) : variables.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No environment variables configured yet.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {variables.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-medium text-white">{v.key}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                      {v.environment}
                    </span>
                    {v.isSecret && (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        Encrypted Secret
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{v.maskedValue}</div>
                </div>

                <button
                  onClick={() => handleDelete(v.id)}
                  className="text-xs text-rose-400 hover:text-rose-300 transition px-2 py-1"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
