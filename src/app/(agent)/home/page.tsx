'use client';
import dynamic from 'next/dynamic';

// SSR disabled: component uses Dexie (IndexedDB), Zustand/localStorage,
// and the Geolocation API — all browser-only.
const HomeClient = dynamic(() => import('./HomeClient'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      Loading…
    </div>
  ),
});

export default function HomePage() {
  return <HomeClient />;
}
