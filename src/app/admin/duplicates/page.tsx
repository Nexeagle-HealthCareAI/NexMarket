'use client';
import dynamic from 'next/dynamic';

const DuplicatesClient = dynamic(() => import('./DuplicatesClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Duplicate Contact Review…</div>,
});

export default function AdminDuplicatesPage() {
  return <DuplicatesClient />;
}
