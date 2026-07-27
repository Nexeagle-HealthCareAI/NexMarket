'use client';
import dynamic from 'next/dynamic';
import { use } from 'react';

const ContactDetailClient = dynamic(() => import('./ContactDetailClient'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading contact…</div>,
});

export default function ContactDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const resolvedParams = use(params);
  return <ContactDetailClient clientId={resolvedParams.clientId} />;
}
