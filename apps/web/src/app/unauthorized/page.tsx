import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="page-shell" style={{ maxWidth: 560 }}>
      <h1>Access denied</h1>
      <p>
        You do not have permission to view this area, or your account status
        blocks access. Contact an administrator if you believe this is an error.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Link href="/dashboard" className="btn btn-primary">
          Go to dashboard
        </Link>
        <Link href="/login" className="btn btn-secondary">
          Sign in with another account
        </Link>
      </div>
    </div>
  );
}
