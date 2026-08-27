'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AdminErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin Board Error:', error);
  }, [error]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '2rem', textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        <svg fill="none" viewBox="0 0 24 24" stroke="#dc2626" strokeWidth={2} style={{ width: 40, height: 40 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', marginBottom: '1rem' }}>Admin Dashboard Error</h2>
      <p style={{ color: '#475569', marginBottom: '2rem', maxWidth: '450px', lineHeight: 1.6 }}>
        The system encountered an error loading this module. This could be due to a network interruption or corrupted data.
      </p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => reset()} className="btn btn-primary">
          Try Again
        </button>
        <Link href="/admin" className="btn btn-secondary">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
