'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import type { AssignmentPanchayatDto } from '@/lib/sync/api-client';

interface TaskMapProps {
  panchayats: AssignmentPanchayatDto[];
}

export default function TaskMap({ panchayats }: TaskMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasLoadedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const ownMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  // Not shift-scoped — this is just "where am I relative to my panchayats",
  // not the recorded trajectory, so record stays false.
  const { position } = useGeolocation({ record: false });

  const located = panchayats.filter(
    (p): p is AssignmentPanchayatDto & { centroidLat: number; centroidLng: number } =>
      p.centroidLat != null && p.centroidLng != null,
  );

  // Initialize map once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBasemapStyle(),
      center: [87.5701, 25.5541], // Seemanchal center — refit once panchayats are known
      zoom: 9,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    // See MapClient.tsx for why this only surfaces an error before the first
    // successful load — an error afterward is normal per-tile flakiness.
    map.on('error', (e) => {
      console.error('Task map error', e.error);
      if (!hasLoadedRef.current) setMapError(true);
    });

    map.on('load', () => {
      hasLoadedRef.current = true;
      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      hasLoadedRef.current = false;
    };
  }, []);

  // Panchayat pins — green if visited, amber if pending.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (located.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    located.forEach((p) => {
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.background = p.visited ? '#10b981' : '#f59e0b';
      el.style.border = '2px solid #fff';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.centroidLng, p.centroidLat])
        .setPopup(
          new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<div style="padding:4px;font-family:inherit;">
              <strong style="font-size:0.85rem;">${p.name}</strong><br/>
              <span style="font-size:0.72rem;color:${p.visited ? '#10b981' : '#b45309'}">${p.visited ? '✅ Visited' : '⏳ Pending'}</span>
            </div>`,
          ),
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([p.centroidLng, p.centroidLat]);
    });

    if (position) bounds.extend([position.lng, position.lat]);

    if (located.length === 1 && !position) {
      map.flyTo({ center: [located[0].centroidLng, located[0].centroidLat], zoom: 12 });
    } else {
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
    }
    // Only refit when the panchayat set itself changes, not on every GPS tick —
    // otherwise the map would keep re-centering under the agent's thumb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, located.map((p) => p.panchayatId).join(',')]);

  // "You are here" marker — updates in place, never refits the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !position) return;

    if (!ownMarkerRef.current) {
      const el = document.createElement('div');
      el.style.width = '18px';
      el.style.height = '18px';
      el.style.borderRadius = '50%';
      el.style.background = '#3b82f6';
      el.style.border = '3px solid #fff';
      el.style.boxShadow = '0 0 10px rgba(59,130,246,0.8)';
      // setLngLat before addTo, not after — addTo() triggers an immediate
      // internal position update, which crashed reading .lng off the
      // marker's default (unset) position when this was the other way
      // around. The panchayat markers above already do it in this order.
      ownMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(map);
    } else {
      ownMarkerRef.current.setLngLat([position.lng, position.lat]);
    }
  }, [position, mapLoaded]);

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)', height: '260px', marginBottom: '1.25rem' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {mapError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.85)', color: '#fff', textAlign: 'center', padding: '1rem', zIndex: 5 }}>
          <p style={{ fontSize: '0.8rem' }}>🗺️ Map unavailable right now — your task list below still works.</p>
        </div>
      )}

      {located.length === 0 && !mapError && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(255,255,255,0.9)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem', fontSize: '0.72rem', color: '#64748b', zIndex: 5 }}>
          No location data yet for these panchayats.
        </div>
      )}
    </div>
  );
}
