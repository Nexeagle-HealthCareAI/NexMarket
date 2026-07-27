'use client';
import dynamic from 'next/dynamic';
const VisitClient = dynamic(() => import('./VisitClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>,
});
export default function VisitPage() {
  return <VisitClient />;
}
