'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    workbox?: { register: () => void };
  }
}

export default function PwaRegister() {
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // next.config.ts disables the Serwist build in development, so /sw.js is
    // never generated there — registering it anyway always 404s.
    if (process.env.NODE_ENV !== 'production') return;

    // When a new SW version takes control of an already-open tab (skipWaiting +
    // clientsClaim), reload once so the page picks up the new build's module
    // graph instead of continuing to run against now-mismatched chunk hashes —
    // that mismatch is what causes "Failed to load module script" / SW
    // "no-response" errors on the next client-side navigation. This can land
    // on *any* page, at any point after a deploy, whenever the browser
    // happens to check for a SW update next — an instant, unexplained reload
    // was easily mistaken for the app crashing. Showing this banner first
    // makes it obvious it's an intentional update, not a bug.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      setUpdating(true);
      setTimeout(() => window.location.reload(), 900);
    });

    if (window.workbox !== undefined) {
      window.workbox.register();
    } else {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Service Worker registration failed:', err);
      });
    }
  }, []);

  if (!updating) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999999,
        background: '#4f46e5', color: 'white', textAlign: 'center',
        padding: '0.6rem 1rem', fontSize: '0.85rem', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
      }}
    >
      <span className="spin" style={{ display: 'inline-flex', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%' }} />
      Updating to the latest version…
    </div>
  );
}
