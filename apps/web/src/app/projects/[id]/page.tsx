'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';
import { SafeProject, SafeDeploymentSummary } from '@deployforge/shared-types';

export default function ProjectDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [project, setProject] = useState<SafeProject | null>(null);
  const [deployments, setDeployments] = useState<SafeDeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [resolvedParams.id]);

  const fetchData = async () => {
    try {
      const [projData, depData] = await Promise.all([
        apiRequest<SafeProject>(`/projects/${resolvedParams.id}`),
        apiRequest<{ items: SafeDeploymentSummary[] }>(`/projects/${resolvedParams.id}/deployments?limit=10`),
      ]);
      setProject(projData);
      setDeployments(depData.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load project details');
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
    return <div className="text-slate-400 py-12 text-center animate-pulse">Loading project details...</div>;
  }

  if (!project) {
    return <div className="text-rose-400 py-12 text-center">Project not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">{project.name}</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-300">
              {project.framework}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            {project.repoUrl} &bull; branch: <span className="text-sky-400">{project.defaultBranch}</span>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href={`/projects/${project.id}/settings/env`}
            className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
          >
            Environment Variables
          </Link>
          <button
            onClick={handleTriggerDeployment}
            disabled={deploying}
            className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
          >
            {deploying ? 'Queueing...' : 'Deploy Now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Deployment History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Deployment History</h2>
          <span className="text-xs text-slate-500">{deployments.length} deployments</span>
        </div>

        {deployments.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No deployments recorded yet. Click &quot;Deploy Now&quot; to queue a build.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {deployments.map((d) => (
              <Link
                key={d.id}
                href={`/projects/${project.id}/deployments/${d.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 transition group"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs text-sky-400 group-hover:underline">
                      {d.commitSha.substring(0, 7)}
                    </span>
                    <span className="text-sm text-slate-200">
                      {d.commitMessage || 'Manual build'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-slate-500">
                    <span>branch: {d.branch}</span>
                    <span>&bull;</span>
                    <span>{new Date(d.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      d.status === 'SUCCEEDED'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : d.status === 'FAILED'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : d.status === 'QUEUED'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-sky-500/10 text-sky-400 animate-pulse'
                    }`}
                  >
                    {d.status}
                  </span>
                  <span className="text-slate-600 group-hover:text-slate-400 text-sm">&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
