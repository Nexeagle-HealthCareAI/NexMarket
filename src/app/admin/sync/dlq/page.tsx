'use client';
import dynamic from 'next/dynamic';

const DlqClient = dynamic(() => import('./DlqClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading DLQ…</div>,
});

export default function DlqPage() {
  return <DlqClient />;
}
