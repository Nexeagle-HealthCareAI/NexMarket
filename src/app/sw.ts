import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig, RuntimeCaching } from 'serwist';
import { Serwist, CacheFirst, ExpirationPlugin } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const mapboxCache: RuntimeCaching = {
  matcher: ({ url }) => url.origin === 'https://api.mapbox.com' && url.pathname.includes('/tiles/'),
  handler: new CacheFirst({
    cacheName: 'mapbox-tiles',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 1000,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [mapboxCache, ...defaultCache],
});

serwist.addEventListeners();

import { db } from '../lib/db/schema';
import { v4 as uuidv4 } from 'uuid';

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New Notification';
  const body = data.body || '';
  const extraData = data.data || {};

  event.waitUntil(
    (async () => {
      // 1. Show native push notification
      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: extraData,
      });

      // 2. Save to Dexie DB so the app can show it in the dropdown
      try {
        await db.notifications.add({
          id: uuidv4(),
          title,
          body,
          data: extraData,
          isRead: false,
          timestamp: new Date().toISOString()
        });
        
        // Notify open clients to refresh their UI
        const clients = await self.clients.matchAll();
        clients.forEach(client => client.postMessage({ type: 'NOTIFICATION_ADDED' }));
      } catch (err) {
        console.error('Failed to save notification to IndexedDB:', err);
      }
    })()
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  // Open the app or focus the current window
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
