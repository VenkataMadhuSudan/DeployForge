import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'DeployForge — Automated Website Deployment Platform',
  description:
    'Build, deploy, and manage websites from GitHub repositories with automated CI/CD pipelines, build logs, and rollback support.',
  openGraph: {
    title: 'DeployForge',
    description: 'Git-powered automated deployment platform.',
    type: 'website',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>

        {/* ── Navbar ──────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-50"
          style={{
            background: 'rgba(5,8,16,0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-6">

            {/* Logo */}
            <Link href="/dashboard" className="flex items-center gap-2.5 group" id="nav-logo">
              {/* Forge icon */}
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-black"
                style={{ background: 'var(--gradient-brand)', boxShadow: '0 2px 10px var(--accent-glow)' }}
              >
                ⚡
              </div>
              <span className="text-base font-bold gradient-text tracking-tight">DeployForge</span>
            </Link>

            {/* Nav links */}
            <nav className="hidden sm:flex items-center gap-1">
              <Link href="/dashboard" className="nav-item text-sm">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
                Projects
              </Link>
              <Link href="/projects/new" className="nav-item text-sm" id="nav-new-project">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Project
              </Link>
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Link href="/login" className="btn btn-secondary text-sm px-3 py-1.5" id="nav-login">
                Sign In
              </Link>
              <Link href="/register" className="btn btn-primary text-sm px-3.5 py-1.5" id="nav-register">
                Get Started
              </Link>
            </div>

          </div>
        </header>

        {/* ── Page content ────────────────────────────────────── */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* ── Footer ──────────────────────────────────────────── */}
        <footer
          className="py-6 text-center text-xs"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          DeployForge &copy; {new Date().getFullYear()} &mdash; Automated Website Deployment &amp; Management Platform
        </footer>

      </body>
    </html>
  );
}
