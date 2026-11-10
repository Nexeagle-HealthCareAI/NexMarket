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
    // A first visit has no controller yet: the new worker claiming the page then is not an update, so no reload.
    let hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    // Never reload in the middle of a call (the call window is open): wait until it is closed.
    const reloadWhenFree = () => {
      if (document.querySelector('.cl-win')) { waitTimer = setTimeout(reloadWhenFree, 3000); return; }
      setUpdating(true);
      setTimeout(() => window.location.reload(), 900);
    };
    const onChange = () => {
      if (!hadController) { hadController = true; return; }
      if (reloaded) return;
      reloaded = true;
      reloadWhenFree();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);

    if (window.workbox !== undefined) {
      window.workbox.register();
    } else {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Service Worker registration failed:', err);
      });
    }
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      if (waitTimer) clearTimeout(waitTimer);
    };
  }, []);

  if (!updating) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999999,
        background: '#0a72d6', color: 'white', textAlign: 'center',
        padding: '0.6rem 1rem', fontSize: '0.85rem', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
      }}
    >
      <span className="spin" style={{ display: 'inline-flex', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%' }} />
      Updating to the latest version…
    </div>
  );
}
