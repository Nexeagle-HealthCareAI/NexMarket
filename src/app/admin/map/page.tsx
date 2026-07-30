'use client';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Live Map & Trajectories…</div>,
});

export default function AdminMapPage() {
  return (
    <Suspense fallback={<div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Live Map & Trajectories…</div>}>
      <MapClient />
    </Suspense>
  );
}
