'use client';
import dynamic from 'next/dynamic';

const ReportsClient = dynamic(() => import('./ReportsClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Reports & Analytics…</div>,
});

export default function AdminReportsPage() {
  return <ReportsClient />;
}
