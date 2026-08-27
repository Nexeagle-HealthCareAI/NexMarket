'use client';

import { useEffect } from 'react';

export default function AgentErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Agent App Error:', error);
  }, [error]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: '1.5rem', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
        <svg fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth={2} style={{ width: 28, height: 28 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem' }}>Oops! Something went wrong.</h2>
      <p style={{ color: '#64748b', marginBottom: '2rem', fontSize: '0.95rem' }}>
        Don't worry, your unsynced offline data is safe. Please try refreshing.
      </p>
      <button 
        onClick={() => reset()}
        className="btn btn-primary"
        style={{ width: '100%', maxWidth: '280px' }}
      >
        Refresh & Try Again
      </button>
    </div>
  );
}
