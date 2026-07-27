'use client';

import React, { useEffect, useState } from 'react';

export default function NotificationListener() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    // Check current permission
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    // Listen for broadcast messages from Admin tab
    const channel = new BroadcastChannel('nexmarket-notifications');
    
    channel.onmessage = (event) => {
      const { title, body } = event.data;
      
      // If we have permission, show a real system notification!
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body: body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        });
      } else {
        // Fallback: Just alert or console log for demo purposes if permission not granted
        console.log('Received Push Notification:', title, body);
        alert(`🔔 Push Notification:\n\n${title}\n${body}`);
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  if (permission === 'granted' || permission === 'denied') return null;

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.9)',
      backdropFilter: 'blur(8px)',
      border: '1px solid var(--surface-border)',
      padding: '0.75rem 1rem',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      margin: '0 0 1rem 0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.25rem' }}>🔔</span>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>Enable Notifications</h4>
          <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Get alerts for new assignments.</p>
        </div>
      </div>
      <button 
        onClick={requestPermission}
        style={{
          background: 'var(--color-primary-600)',
          color: 'white',
          border: 'none',
          padding: '0.4rem 0.8rem',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        Enable
      </button>
    </div>
  );
}
