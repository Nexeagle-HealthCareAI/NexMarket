'use client';
import dynamic from 'next/dynamic';
const HistoryClient = dynamic(() => import('./HistoryClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>,
});
export default function HistoryPage() {
  return <HistoryClient />;
}
