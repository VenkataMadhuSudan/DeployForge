'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeProject } from '@deployforge/shared-types';

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
      if (err.message.includes('401') || err.message.includes('missing')) {
        router.push('/login');
        return;
      }
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status?: string | null) => {
    if (!status) return <span className="text-slate-500 text-xs">No deployments</span>;
    switch (status) {
      case 'SUCCEEDED':
        return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-medium">Ready</span>;
      case 'BUILDING':
      case 'DEPLOYING':
      case 'PREPARING':
        return <span className="px-2.5 py-1 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full text-xs font-medium animate-pulse">{status}</span>;
      case 'QUEUED':
        return <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-xs font-medium">Queued</span>;
      case 'FAILED':
        return <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-medium">Failed</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-800 text-slate-400 rounded-full text-xs font-medium">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Deployment Projects</h1>
          <p className="text-sm text-slate-400 mt-1">Overview of connected repositories, builds, and hosting targets.</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center justify-center bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition"
        >
          + New Project
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-slate-900/50 border border-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl">
          <h3 className="text-base font-medium text-slate-300">No deployment projects yet</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Create your first project to connect a Git repository and start automated website builds.
          </p>
          <div className="mt-6">
            <Link
              href="/projects/new"
              className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition"
            >
              Create Project
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group block bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition shadow-sm hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white group-hover:text-sky-400 transition">
                    {project.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {project.repoOwner}/{project.repoName}
                  </p>
                </div>
                {getStatusBadge(project.latestDeployment?.status)}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-600" />
                  <span>{project.defaultBranch}</span>
                </span>
                <span>{project.framework}</span>
              </div>

              {project.latestDeployment?.deploymentUrl && (
                <div className="mt-3 text-xs text-sky-400 truncate hover:underline">
                  {project.latestDeployment.deploymentUrl}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
