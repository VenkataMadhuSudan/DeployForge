'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeDeploymentSummary, SafeDeploymentLog, BuildStage, DeploymentStatus } from '@deployforge/shared-types';

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    SUCCEEDED:   { cls: 'badge-success', label: '● Succeeded' },
    FAILED:      { cls: 'badge-danger',  label: '✕ Failed' },
    QUEUED:      { cls: 'badge-warning', label: 'Queued' },
    BUILDING:    { cls: 'badge-info badge-pulse', label: 'Building' },
    DEPLOYING:   { cls: 'badge-info badge-pulse', label: 'Deploying' },
    PREPARING:   { cls: 'badge-info badge-pulse', label: 'Preparing' },
    CANCELLED:   { cls: 'badge-neutral', label: 'Cancelled' },
    ROLLED_BACK: { cls: 'badge-neutral', label: 'Rolled Back' },
  };
  const s = status || 'QUEUED';
  const { cls, label } = map[s] ?? { cls: 'badge-neutral', label: s };
  return <span className={`badge text-sm px-3 py-1 ${cls}`}>{label}</span>;
}

function LogLine({ log }: { log: SafeDeploymentLog }) {
  const lvl = log.level?.toLowerCase() ?? 'info';
  const lineClass =
    lvl === 'error' ? 'log-line error' :
    lvl === 'warn'  ? 'log-line warning' :
    log.stage === BuildStage.DEPLOY ? 'log-line success' :
    log.stage === BuildStage.PREPARE ? 'log-line header' :
    'log-line info';

  const stagePill =
    lvl === 'error'   ? { bg: 'rgba(248,113,113,0.15)', color: '#f87171' } :
    lvl === 'warn'    ? { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' } :
    { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' };

  return (
    <div className="flex items-start gap-3 px-1 py-0.5 rounded hover:bg-white/[0.025] transition-colors">
      <span className="text-[11px] select-none shrink-0 w-20 tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span
        className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded select-none shrink-0"
        style={{ background: stagePill.bg, color: stagePill.color }}
      >
        {log.stage || 'BUILD'}
      </span>
      <span className={lineClass} style={{ flex: 1 }}>{log.message}</span>
    </div>
  );
}

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
  const [autoScroll, setAutoScroll] = useState(true);
  const lastSeqRef = useRef<number>(0);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isFetchingLogsRef = useRef<boolean>(false);

  const isTerminalState =
    deployment?.status === DeploymentStatus.SUCCEEDED ||
    deployment?.status === DeploymentStatus.FAILED ||
    deployment?.status === DeploymentStatus.CANCELLED;

  useEffect(() => {
    fetchDeployment();
    fetchLogs();

    const interval = setInterval(() => {
      fetchDeployment();
      fetchLogs();
    }, 1500);

    return () => clearInterval(interval);
  }, [resolvedParams.id, resolvedParams.deploymentId]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

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
    if (isFetchingLogsRef.current) return;
    isFetchingLogsRef.current = true;
    try {
      const data = await apiRequest<{ logs: SafeDeploymentLog[]; nextSequence: number | null }>(
        `/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/logs?after=${lastSeqRef.current}&limit=500`
      );
      if (data?.logs && data.logs.length > 0) {
        setLogs((prev) => {
          const seenIds = new Set(prev.map((l) => l.id));
          const newEntries = data.logs.filter((l) => !seenIds.has(l.id));
          if (newEntries.length === 0) return prev;
          return [...prev, ...newEntries];
        });
        const maxSeq = Math.max(...data.logs.map((l) => l.sequenceNumber), lastSeqRef.current);
        lastSeqRef.current = maxSeq;
      }
    } catch {
      // ignore polling errors
    } finally {
      isFetchingLogsRef.current = false;
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiRequest(`/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/cancel`, { method: 'POST' });
      fetchDeployment();
    } catch (err: any) {
      setError(`Cancel failed: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  const handleRollback = async () => {
    if (!confirm('Roll back to this deployment? A new deployment record will be created.')) return;
    setRollingBack(true);
    try {
      const rolled = await apiRequest<SafeDeploymentSummary>(
        `/projects/${resolvedParams.id}/deployments/${resolvedParams.deploymentId}/rollback`,
        { method: 'POST' }
      );
      router.push(`/projects/${resolvedParams.id}/deployments/${rolled.id}`);
    } catch (err: any) {
      setError(`Rollback failed: ${err.message}`);
      setRollingBack(false);
    }
  };

  // Duration calculation
  const duration = (() => {
    if (!deployment?.createdAt) return null;
    const end = deployment.completedAt ? new Date(deployment.completedAt) : new Date();
    const diff = Math.floor((end.getTime() - new Date(deployment.createdAt).getTime()) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  })();

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Breadcrumb ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <Link
          href={`/projects/${resolvedParams.id}`}
          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          className="hover:text-white transition"
        >
          ← Project
        </Link>
        <span>/</span>
        <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
          {resolvedParams.deploymentId.substring(0, 8)}
        </span>
      </div>

      {/* ── Info card ─────────────────────────────────────────── */}
      <div
        className="glass-card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
        style={{ borderRadius: '16px' }}
      >
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Deployment
            </h1>
            <StatusBadge status={deployment?.status} />
            {!isTerminalState && (
              <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>
                (polling…)
              </span>
            )}
          </div>

          <div className="mt-2 space-y-1 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {deployment?.commitSha && (
              <p>
                <span style={{ color: 'var(--text-muted)' }}>commit </span>
                <span style={{ color: 'var(--accent)' }}>{deployment.commitSha.substring(0, 12)}</span>
                <span style={{ color: 'var(--text-muted)' }}> on </span>
                <span>{deployment.branch}</span>
              </p>
            )}
            {deployment?.commitMessage && (
              <p style={{ color: 'var(--text-secondary)' }}>{deployment.commitMessage}</p>
            )}
            {duration && (
              <p style={{ color: 'var(--text-muted)' }}>Duration: {duration}</p>
            )}
            {deployment?.deploymentUrl && (
              <p>
                <a
                  href={deployment.deploymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: 'var(--success)' }}
                >
                  ↗ {deployment.deploymentUrl}
                </a>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isTerminalState && (
            <button
              id="cancel-deployment-btn"
              onClick={handleCancel}
              disabled={cancelling}
              className="btn btn-danger text-xs"
            >
              {cancelling ? 'Cancelling…' : 'Cancel Build'}
            </button>
          )}
          {deployment?.status === 'SUCCEEDED' && (
            <button
              id="rollback-deployment-btn"
              onClick={handleRollback}
              disabled={rollingBack}
              className="btn btn-secondary text-xs"
            >
              {rollingBack ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Rolling back…
                </span>
              ) : '↩ Rollback to This'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error animate-fade-in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Terminal Log Viewer ────────────────────────────────── */}
      <div style={{
        background: '#080c14',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        {/* Terminal titlebar */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
            </div>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              build &amp; deployment logs
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {logs.length} lines
            </span>
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className="text-xs px-2 py-0.5 rounded transition"
              style={{
                background: autoScroll ? 'rgba(79,142,247,0.15)' : 'rgba(255,255,255,0.05)',
                color: autoScroll ? 'var(--accent)' : 'var(--text-muted)',
                border: `1px solid ${autoScroll ? 'rgba(79,142,247,0.3)' : 'var(--border)'}`,
              }}
            >
              {autoScroll ? '↓ Auto-scroll ON' : '↓ Auto-scroll OFF'}
            </button>
          </div>
        </div>

        {/* Log lines */}
        <div
          ref={logContainerRef}
          id="log-container"
          className="p-4 overflow-y-auto select-text"
          style={{ height: '520px', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {logs.length === 0 ? (
            <div className="flex items-center gap-2 h-full" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Waiting for build worker to start output stream…
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((log) => (
                <LogLine key={`${log.id}-${log.sequenceNumber}`} log={log} />
              ))}
              {!isTerminalState && (
                <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  streaming…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
