'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api-client';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [framework, setFramework] = useState('STATIC');
  const [buildCommand, setBuildCommand] = useState('');
  const [outputDirectory, setOutputDirectory] = useState('dist');
  const [deploymentProvider, setDeploymentProvider] = useState('LOCAL_TESTING');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRepoUrlChange = (url: string) => {
    setRepoUrl(url);
    // Parse owner and repo name from URL e.g. https://github.com/owner/repo
    try {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/i);
      if (match) {
        setRepoOwner(match[1]);
        setRepoName(match[2]);
        if (!name) setName(match[2]);
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const project = await apiRequest('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          repoUrl,
          repoOwner: repoOwner || 'developer',
          repoName: repoName || name.toLowerCase().replace(/\s+/g, '-'),
          defaultBranch,
          framework,
          buildCommand: buildCommand || null,
          outputDirectory,
          deploymentProvider,
        }),
      });
      router.push(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">Create New Project</h1>
        <p className="text-sm text-slate-400 mt-1">Configure your repository source, build settings, and deployment destination.</p>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            Project Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
            placeholder="my-portfolio-site"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            Git Repository URL
          </label>
          <input
            type="url"
            required
            value={repoUrl}
            onChange={(e) => handleRepoUrlChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
            placeholder="https://github.com/username/repository"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Repo Owner / Org
            </label>
            <input
              type="text"
              required
              value={repoOwner}
              onChange={(e) => setRepoOwner(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
              placeholder="github-username"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Repo Name
            </label>
            <input
              type="text"
              required
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
              placeholder="repo-name"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Production Branch
            </label>
            <input
              type="text"
              required
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
              placeholder="main"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Framework Preset
            </label>
            <select
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
            >
              <option value="STATIC">Static HTML</option>
              <option value="REACT_VITE">React / Vite</option>
              <option value="NEXTJS">Next.js</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Build Command (Optional)
            </label>
            <input
              type="text"
              value={buildCommand}
              onChange={(e) => setBuildCommand(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
              placeholder="npm run build"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Output Directory
            </label>
            <input
              type="text"
              required
              value={outputDirectory}
              onChange={(e) => setOutputDirectory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
              placeholder="dist"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            Hosting Provider Adapter
          </label>
          <select
            value={deploymentProvider}
            onChange={(e) => setDeploymentProvider(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition"
          >
            <option value="LOCAL_TESTING">Local Testing Adapter (Isolated Local Storage)</option>
            <option value="CLOUDFLARE_PAGES">Cloudflare Pages (Live CDN)</option>
          </select>
        </div>

        <div className="pt-2 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-5 py-2 rounded-lg text-sm transition disabled:opacity-50"
          >
            {loading ? 'Creating Project...' : 'Create & Configure'}
          </button>
        </div>
      </form>
    </div>
  );
}
