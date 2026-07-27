'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    workbox?: { register: () => void };
  }
}

export default function PwaRegister() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      window.workbox !== undefined
    ) {
      const wb = window.workbox;
      // You can add event listeners here to show an update prompt when the SW updates.
      wb.register();
    } else if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator
    ) {
      // Basic registration fallback
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Service Worker registration failed:', err);
      });
    }
  }, []);

  return null; // This component doesn't render anything
}
