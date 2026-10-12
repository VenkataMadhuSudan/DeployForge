import Link from 'next/link';

export default function HomePage() {
  const features = [
    {
      icon: '⚡',
      title: 'Instant Deployments',
      desc: 'Push to Git and watch your site go live in seconds with zero-config automated pipelines.',
    },
    {
      icon: '📜',
      title: 'Live Build Logs',
      desc: 'Stream real-time build output line-by-line. Diagnose failures instantly.',
    },
    {
      icon: '🔄',
      title: 'One-Click Rollback',
      desc: 'Every deployment is versioned. Roll back to any previous successful build instantly.',
    },
    {
      icon: '🔐',
      title: 'Encrypted Secrets',
      desc: 'Environment variables are stored with AES-256-GCM encryption at rest.',
    },
    {
      icon: '🌐',
      title: 'Multi-Provider',
      desc: 'Deploy to Cloudflare Pages, AWS S3, or use the local testing adapter for development.',
    },
    {
      icon: '🪝',
      title: 'GitHub Webhooks',
      desc: 'HMAC-verified webhook integration triggers deployments on every push automatically.',
    },
  ];

  return (
    <div className="relative">
      {/* Animated glow background */}
      <div className="hero-glow" />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative pt-20 pb-24 text-center" style={{ zIndex: 1 }}>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold mb-8 animate-fade-in"
          style={{ background: 'rgba(79,142,247,0.1)', border: '1px solid rgba(79,142,247,0.25)', color: 'var(--accent-hover)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          Platform live — automated deployments ready
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight animate-fade-in-up"
          style={{ lineHeight: 1.08, letterSpacing: '-0.03em' }}>
          Deploy faster.<br />
          <span className="gradient-text">Ship with confidence.</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl max-w-2xl mx-auto animate-fade-in-up delay-100"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          DeployForge connects your GitHub repositories to any hosting provider.
          Automated builds, encrypted secrets, live logs, and instant rollbacks — all in one platform.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up delay-200">
          <Link href="/register" id="hero-cta-register" className="btn btn-primary text-base px-7 py-3">
            Start deploying free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link href="/dashboard" id="hero-cta-dashboard" className="btn btn-secondary text-base px-7 py-3">
            View Dashboard
          </Link>
        </div>
      </section>

      {/* ── Features grid ─────────────────────────────────────── */}
      <section className="relative pb-24" style={{ zIndex: 1 }}>
        <div className="section-divider mb-16" />
        <h2 className="text-center text-2xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          Everything you need to ship
        </h2>
        <p className="text-center text-sm mb-12" style={{ color: 'var(--text-secondary)' }}>
          Production-grade tooling from day one.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`glass-card p-6 animate-fade-in-up delay-${(i % 5 + 1) * 100}`}
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────────────────── */}
      <section className="relative pb-16" style={{ zIndex: 1 }}>
        <div
          className="rounded-2xl p-10 text-center relative overflow-hidden"
          style={{ background: 'var(--gradient-brand)', boxShadow: '0 8px 40px var(--accent-glow)' }}
        >
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <h2 className="text-2xl font-extrabold text-white relative z-10">Ready to automate your deployments?</h2>
          <p className="mt-2 text-white/80 text-sm relative z-10">Connect your first repository in under two minutes.</p>
          <Link href="/register" className="mt-6 inline-block btn text-sm font-semibold relative z-10"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}>
            Create Free Account →
          </Link>
        </div>
      </section>
    </div>
  );
}
