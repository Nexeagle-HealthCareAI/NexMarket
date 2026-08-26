'use client';

import React, { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function NotificationListener() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const agentId = useAgentStore((state: any) => state.agentId);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
      
      // Auto-subscribe if permission was already granted
      if (Notification.permission === 'granted' && agentId) {
        subscribeToPush();
      }
    }

    const channel = new BroadcastChannel('nexmarket-notifications');
    channel.onmessage = (event) => {
      const { title, body } = event.data;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' });
      }
    };

    return () => channel.close();
  }, [agentId]);

  const subscribeToPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!publicVapidKey) {
          console.error('VAPID key not found');
          return;
        }
        
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
        });
      }

      // Send to server
      if (agentId) {
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, subscription })
        });
      }
    } catch (err) {
      console.error('Failed to subscribe to web push:', err);
    }
  };

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      subscribeToPush();
    }
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
