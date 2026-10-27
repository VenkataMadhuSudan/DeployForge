import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        🔍
      </div>
      <h2 className="text-3xl font-extrabold mb-3 text-white">404 &mdash; Page Not Found</h2>
      <p className="max-w-md mb-8" style={{ color: 'var(--text-muted)' }}>
        The page or deployment you are looking for does not exist or has been moved.
      </p>
      <Link href="/dashboard" className="btn btn-primary px-5 py-2.5">
        Return to Dashboard
      </Link>
    </div>
  );
}
