'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeProject } from '@deployforge/shared-types';

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="badge badge-neutral">No deploys</span>;
  switch (status) {
    case 'SUCCEEDED':
      return <span className="badge badge-success">● Live</span>;
    case 'BUILDING':
      return <span className="badge badge-info badge-pulse">Building</span>;
    case 'DEPLOYING':
      return <span className="badge badge-info badge-pulse">Deploying</span>;
    case 'PREPARING':
      return <span className="badge badge-info badge-pulse">Preparing</span>;
    case 'QUEUED':
      return <span className="badge badge-warning">Queued</span>;
    case 'FAILED':
      return <span className="badge badge-danger">Failed</span>;
    case 'CANCELLED':
      return <span className="badge badge-neutral">Cancelled</span>;
    default:
      return <span className="badge badge-neutral">{status}</span>;
  }
}

function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: '16px',
      padding: '24px',
      height: '168px',
    }}>
      <div className="skeleton h-4 w-3/4 mb-3" />
      <div className="skeleton h-3 w-1/2 mb-6" />
      <div className="skeleton h-3 w-1/3" />
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<SafeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const data = await apiRequest<SafeProject[]>('/projects');
      setProjects(data);
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        router.push('/login');
        return;
      }
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  // Stats
  const live = projects.filter((p) => p.latestDeployment?.status === 'SUCCEEDED').length;
  const failing = projects.filter((p) => p.latestDeployment?.status === 'FAILED').length;
  const building = projects.filter((p) =>
    ['BUILDING', 'DEPLOYING', 'QUEUED', 'PREPARING'].includes(p.latestDeployment?.status ?? '')
  ).length;

  return (
    <div className="space-y-8">

      {/* ── Page header ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Deployment Projects
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Manage your connected repositories, builds, and hosting targets.
          </p>
        </div>
        <Link href="/projects/new" id="dashboard-new-project" className="btn btn-primary text-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Project
        </Link>
      </div>

      {/* ── Stat row ──────────────────────────────────────────── */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fade-in-up">
          {[
            { label: 'Total Projects', value: projects.length, color: 'var(--accent)' },
            { label: 'Live', value: live, color: 'var(--success)' },
            { label: 'Building', value: building, color: 'var(--info)' },
            { label: 'Failing', value: failing, color: 'var(--danger)' },
          ].map((stat) => (
            <div key={stat.label} className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                {stat.label}
              </p>
              <p className="text-3xl font-extrabold" style={{ color: stat.color }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-error animate-fade-in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Projects grid ─────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : projects.length === 0 ? (
        /* Empty state */
        <div
          className="text-center py-20 rounded-2xl animate-fade-in"
          style={{
            border: '1px dashed var(--border-hover)',
            background: 'rgba(79,142,247,0.02)',
          }}
        >
          <div className="text-5xl mb-4">🚀</div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No projects yet
          </h3>
          <p className="text-sm max-w-sm mx-auto mb-6" style={{ color: 'var(--text-secondary)' }}>
            Connect your first Git repository to start automated builds and deployments.
          </p>
          <Link href="/projects/new" id="empty-create-project" className="btn btn-primary text-sm">
            Create First Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project, i) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              id={`project-card-${project.id}`}
              className={`glass-card p-5 block group animate-fade-in-up delay-${Math.min((i % 5 + 1) * 100, 500)}`}
              style={{ textDecoration: 'none' }}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-base truncate group-hover:text-[var(--accent-hover)] transition"
                    style={{ color: 'var(--text-primary)' }}>
                    {project.name}
                  </h3>
                  <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    {project.repoOwner}/{project.repoName}
                  </p>
                </div>
                <StatusBadge status={project.latestDeployment?.status} />
              </div>

              {/* Meta */}
              <div
                className="flex items-center justify-between text-xs pt-4"
                style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                <span className="flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="3" /><line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" />
                  </svg>
                  {project.defaultBranch}
                </span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                >
                  {project.framework}
                </span>
              </div>

              {/* Deployment URL */}
              {project.latestDeployment?.deploymentUrl && (
                <p className="mt-3 text-xs truncate" style={{ color: 'var(--accent)' }}>
                  ↗ {project.latestDeployment.deploymentUrl}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
