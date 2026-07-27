/**
 * GPS Hook — useGeolocation
 *
 * Wraps the browser Geolocation API with:
 *  - Permission request UX
 *  - Continuous watching during an active shift
 *  - Trajectory point buffering (one point every 45s) written to Dexie
 *  - Clean stop on shift end
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db, getSyncStateValue } from '../db';

export interface GpsPosition {
  lat: number;
  lng: number;
  accuracyM: number;
  timestamp: string;
}

export type GpsPermission = 'prompt' | 'granted' | 'denied' | 'unavailable';

const TRAJECTORY_INTERVAL_MS = 45_000; // 45 seconds

export function useGeolocation(options?: {
  shiftId?: string;
  visitId?: string;
  record?: boolean; // set true to buffer trajectory points
}) {
  const [position, setPosition] = useState<GpsPosition | null>(null);
  const [permission, setPermission] = useState<GpsPermission>('prompt');
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastRecordedRef = useRef<number>(0);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setPermission('unavailable');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const gps: GpsPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp).toISOString(),
        };
        setPosition(gps);
        setPermission('granted');
        setError(null);

        // Buffer trajectory point if recording is enabled
        if (options?.record) {
          const now = Date.now();
          if (now - lastRecordedRef.current >= TRAJECTORY_INTERVAL_MS) {
            lastRecordedRef.current = now;
            const agentId = await getSyncStateValue('agentId');
            const deviceId = await getSyncStateValue('deviceId');
            if (agentId && deviceId) {
              await db.trajectoryPoints.add({
                clientId: uuidv4(),
                deviceId,
                agentId,
                shiftId: options.shiftId,
                visitId: options.visitId,
                lat: gps.lat,
                lng: gps.lng,
                accuracyM: gps.accuracyM,
                recordedAt: gps.timestamp,
              });
            }
          }
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setPermission('denied');
          setError('Location permission denied. Please enable it in browser settings.');
        } else {
          setError(`Location error: ${err.message}`);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      },
    );
  }, [options?.record, options?.shiftId, options?.visitId]);

  useEffect(() => {
    startWatching();
    return stopWatching;
  }, [startWatching, stopWatching]);

  return { position, permission, error, startWatching, stopWatching };
}
