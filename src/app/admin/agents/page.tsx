'use client';
import dynamic from 'next/dynamic';

const AgentsClient = dynamic(() => import('./AgentsClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Field Agents…</div>,
});

export default function AdminAgentsPage() {
  return <AgentsClient />;
}
