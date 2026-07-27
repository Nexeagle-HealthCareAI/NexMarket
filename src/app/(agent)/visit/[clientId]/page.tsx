'use client';
import dynamic from 'next/dynamic';
import { use } from 'react';

const VisitDetailClient = dynamic(() => import('./VisitDetailClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading visit…</div>,
});

export default function VisitDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const resolvedParams = use(params);
  return <VisitDetailClient clientId={resolvedParams.clientId} />;
}
