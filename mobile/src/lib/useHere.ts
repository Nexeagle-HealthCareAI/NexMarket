import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface Here { lat: number; lng: number; accuracy: number | null }

/** Where the agent is: the last known fix straight away, then a fresh one (if allowed). */
export function useHere(fresh = false): Here | null {
  const [here, setHere] = useState<Here | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted) return;
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (alive && last) setHere({ lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null });
      if (fresh || !last) {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
        if (alive && p) setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null });
      }
    })();
    return () => { alive = false; };
  }, [fresh]);
  return here;
}
