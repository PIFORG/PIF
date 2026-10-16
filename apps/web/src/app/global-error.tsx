'use client';

/** Last-resort boundary: replaces the root layout, so it cannot rely on global styles. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 560 }}>
        <main role="alert">
          <h1>The application failed to load</h1>
          <p>Reload the page. If this keeps happening, try again later.</p>
          {error.digest ? <p>Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
