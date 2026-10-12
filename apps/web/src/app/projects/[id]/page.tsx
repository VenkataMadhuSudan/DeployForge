'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeProject, SafeDeploymentSummary } from '@deployforge/shared-types';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    SUCCEEDED:     { cls: 'badge-success', label: '● Live' },
    FAILED:        { cls: 'badge-danger',  label: '✕ Failed' },
    QUEUED:        { cls: 'badge-warning', label: 'Queued' },
    BUILDING:      { cls: 'badge-info badge-pulse', label: 'Building' },
    DEPLOYING:     { cls: 'badge-info badge-pulse', label: 'Deploying' },
    PREPARING:     { cls: 'badge-info badge-pulse', label: 'Preparing' },
    CANCELLED:     { cls: 'badge-neutral', label: 'Cancelled' },
    ROLLED_BACK:   { cls: 'badge-neutral', label: 'Rolled Back' },
  };
  const { cls, label } = map[status] ?? { cls: 'badge-neutral', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function ProjectDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [project, setProject] = useState<SafeProject | null>(null);
  const [deployments, setDeployments] = useState<SafeDeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, [resolvedParams.id]);

  const fetchData = async () => {
    try {
      const [projData, depData] = await Promise.all([
        apiRequest<SafeProject>(`/projects/${resolvedParams.id}`),
        apiRequest<{ items: SafeDeploymentSummary[] }>(`/projects/${resolvedParams.id}/deployments?limit=15`),
      ]);
      setProject(projData);
      setDeployments(depData.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerDeployment = async () => {
    setDeploying(true);
    setError(null);
    try {
      const newDep = await apiRequest<SafeDeploymentSummary>(`/projects/${resolvedParams.id}/deployments`, {
        method: 'POST',
        body: JSON.stringify({
          branch: project?.defaultBranch || 'main',
          commitMessage: 'Manual deployment trigger from web dashboard',
        }),
      });
      router.push(`/projects/${resolvedParams.id}/deployments/${newDep.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to trigger deployment');
      setDeploying(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-4 w-96" />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '16px', height: '300px' }}
          className="skeleton" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-lg" style={{ color: 'var(--danger)' }}>Project not found</p>
        <Link href="/dashboard" className="btn btn-secondary mt-4 text-sm">← Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
        style={{ paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {project.name}
            </h1>
            <span className="code-block">{project.framework}</span>
          </div>
          <p className="text-xs mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{project.repoUrl}</span>
            {' · '}
            <span style={{ color: 'var(--accent)' }}>{project.defaultBranch}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/projects/${project.id}/settings/env`}
            id="project-env-settings"
            className="btn btn-secondary text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Env Vars
          </Link>
          <button
            id="project-deploy-btn"
            onClick={handleTriggerDeployment}
            disabled={deploying}
            className="btn btn-primary text-sm"
          >
            {deploying ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Queueing…
              </span>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Deploy Now
              </>
            )}
          </button>
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

      {/* ── Deployment history table ───────────────────────────── */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Deployment History
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {deployments.length} deployment{deployments.length !== 1 ? 's' : ''}
          </span>
        </div>

        {deployments.length === 0 ? (
          <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="text-3xl mb-3">📦</div>
            <p className="text-sm">No deployments yet. Hit <strong style={{ color: 'var(--text-secondary)' }}>Deploy Now</strong> to queue the first build.</p>
          </div>
        ) : (
          <table className="df-table">
            <thead>
              <tr>
                <th>Commit</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Triggered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id} className="group">
                  <td>
                    <Link
                      href={`/projects/${project.id}/deployments/${d.id}`}
                      id={`deployment-row-${d.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
                        {d.commitSha.substring(0, 7)}
                      </span>
                      <span className="ml-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {d.commitMessage || 'Manual build'}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="code-block">{d.branch}</span>
                  </td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <Link
                      href={`/projects/${project.id}/deployments/${d.id}`}
                      className="text-xs group-hover:text-[var(--accent)] transition"
                      style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                    >
                      View logs →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
