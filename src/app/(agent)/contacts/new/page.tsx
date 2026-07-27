'use client';
import dynamic from 'next/dynamic';
const NewContactClient = dynamic(() => import('./NewContactClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>,
});
export default function NewContactPage() {
  return <NewContactClient />;
}
