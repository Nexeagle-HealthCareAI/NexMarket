'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    workbox?: { register: () => void };
  }
}

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // When a new SW version takes control of an already-open tab (skipWaiting +
    // clientsClaim), reload once so the page picks up the new build's module
    // graph instead of continuing to run against now-mismatched chunk hashes —
    // that mismatch is what causes "Failed to load module script" / SW
    // "no-response" errors on the next client-side navigation.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    if (window.workbox !== undefined) {
      window.workbox.register();
    } else {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Service Worker registration failed:', err);
      });
    }
  }, []);

  return null; // This component doesn't render anything
}
