'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeDeploymentSummary, SafeDeploymentLog } from '@deployforge/shared-types';

export default function DeploymentLogsPage({
  params,
}: {
  params: Promise<{ id: string; deploymentId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [deployment, setDeployment] = useState<SafeDeploymentSummary | null>(null);
  const [logs, setLogs] = useState<SafeDeploymentLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const lastSeqRef = useRef<number>(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDeployment();
    fetchLogs();

    // Poll logs every 1.5 seconds if active
    const interval = setInterval(() => {
      fetchDeployment();
      fetchLogs();
    }, 1500);

    return () => clearInterval(interval);
  }, [resolvedParams.id, resolvedParams.deploymentId]);

  useEffect(() => {
    // Auto-scroll to bottom of logs
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const fetchDeployment = async () => {
    try {
      const data = await apiRequest<SafeDeploymentSummary>(
        `/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}`
      );
      setDeployment(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch deployment');
    }
  };

  const fetchLogs = async () => {
    try {
      const data = await apiRequest<{ logs: SafeDeploymentLog[]; nextSequence: number | null }>(
        `/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/logs?after=${lastSeqRef.current}&limit=500`
      );
      if (data.logs.length > 0) {
        setLogs((prev) => [...prev, ...data.logs]);
        if (data.nextSequence) {
          lastSeqRef.current = data.nextSequence;
        }
      }
    } catch {
      // ignore transient polling errors
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiRequest(`/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/cancel`, {
        method: 'POST',
      });
      fetchDeployment();
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    try {
      const rolled = await apiRequest<SafeDeploymentSummary>(
        `/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/rollback`,
        { method: 'POST' }
      );
      router.push(`/projects/${resolvedParams.id}/deployments/${rolled.id}`);
    } catch (err: any) {
      alert(`Rollback failed: ${err.message}`);
      setRollingBack(false);
    }
  };

  const isTerminalState =
    deployment?.status === 'SUCCEEDED' ||
    deployment?.status === 'FAILED' ||
    deployment?.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center space-x-2 text-xs text-slate-400">
        <Link href={`/projects/${resolvedParams.id}`} className="hover:text-white transition">
          &larr; Back to Project
        </Link>
        <span>/</span>
        <span className="text-slate-200">Deployment {resolvedParams.deploymentId.substring(0, 8)}</span>
      </div>

      {/* Header Info Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-bold text-white">Deployment Status</h1>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                deployment?.status === 'SUCCEEDED'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : deployment?.status === 'FAILED'
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
              }`}
            >
              {deployment?.status || 'LOADING'}
            </span>
          </div>

          <div className="mt-2 text-xs text-slate-400 font-mono space-y-1">
            <p>Commit: {deployment?.commitSha} ({deployment?.branch})</p>
            {deployment?.deploymentUrl && (
              <p>
                Live URL:{' '}
                <a
                  href={deployment.deploymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:underline"
                >
                  {deployment.deploymentUrl} &nearr;
                </a>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {!isTerminalState && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3.5 py-1.5 bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 rounded-lg text-xs font-medium transition disabled:opacity-50"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Build'}
            </button>
          )}

          {deployment?.status === 'SUCCEEDED' && (
            <button
              onClick={handleRollback}
              disabled={rollingBack}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition disabled:opacity-50"
            >
              {rollingBack ? 'Creating Rollback...' : 'Rollback to this version'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Real-time Log Viewer Terminal */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="bg-slate-900/80 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-slate-300 ml-2">Build & Deployment Logs</span>
          </div>
          <span className="text-[11px] text-slate-500">{logs.length} lines</span>
        </div>

        <div
          ref={logContainerRef}
          className="p-4 h-[480px] overflow-y-auto font-mono text-xs leading-relaxed text-slate-300 space-y-1 select-text"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">Waiting for worker process to begin output stream...</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start space-x-3 hover:bg-slate-900/30 px-1 py-0.5 rounded">
                <span className="text-slate-600 select-none text-[11px] w-20 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`select-none text-[10px] uppercase font-bold px-1.5 py-0.2 rounded shrink-0 ${
                    log.level === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-400'
                      : log.level === 'WARN'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {log.stage || 'BUILD'}
                </span>
                <span className="break-all whitespace-pre-wrap">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
