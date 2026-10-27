'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Router runtime error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6"
        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
      >
        ⚠️
      </div>
      <h2 className="text-3xl font-extrabold mb-3 text-white">Something Went Wrong</h2>
      <p className="max-w-md mb-8" style={{ color: 'var(--text-muted)' }}>
        An unexpected application error occurred while processing your request.
      </p>
      <div className="flex gap-4">
        <button onClick={() => reset()} className="btn btn-secondary px-5 py-2.5">
          Try Again
        </button>
        <Link href="/dashboard" className="btn btn-primary px-5 py-2.5">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
