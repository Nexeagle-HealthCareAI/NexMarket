'use client';

import React, { useEffect, useState } from 'react';

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isIosPrompt, setIsIosPrompt] = useState(false);

  useEffect(() => {
    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in window.navigator && (window.navigator as any).standalone);

    if (isIos && !isStandalone) {
      setIsIosPrompt(true);
      setIsVisible(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI to show the install button
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);

    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  if (!isVisible) return null;

  if (isIosPrompt) {
    return (
      <div className="mobile-only-pwa-prompt" style={{
        background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
        color: 'white',
        padding: '0.75rem 1rem',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        margin: '1rem 0',
        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>📱</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Install NexMarket App</h4>
            <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.9 }}>Get offline access and faster loading.</p>
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.8rem', lineHeight: 1.4 }}>
          Tap the <strong>Share</strong> icon at the bottom of your screen, then select <strong>Add to Home Screen</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-only-pwa-prompt" style={{
      background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
      color: 'white',
      padding: '0.75rem 1rem',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      margin: '1rem 0',
      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.5rem' }}>📱</span>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Install NexMarket App</h4>
          <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.9 }}>Get offline access and faster loading.</p>
        </div>
      </div>
      <button 
        onClick={handleInstallClick}
        style={{
          background: 'white',
          color: 'var(--color-primary-600)',
          border: 'none',
          padding: '0.4rem 0.8rem',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        Install
      </button>
    </div>
  );
}
