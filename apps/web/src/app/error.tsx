'use client';

import Link from 'next/link';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-shell" style={{ maxWidth: 560 }} role="alert">
      <h1>Something went wrong</h1>
      <p>This page hit an unexpected error. Your account and data were not changed by it.</p>
      {error.digest ? (
        <p className="field-hint">
          Reference: <code>{error.digest}</code>
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="btn btn-secondary">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
