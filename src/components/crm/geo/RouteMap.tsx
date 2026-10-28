'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import type { AgentActivity, TimelineEvent } from '@/lib/crm/geo';

const KIND_COLOR: Record<string, string> = {
  shift_start: '#0e1525', shift_end: '#0e1525', visit_in: '#16a36a', visit_out: '#16a36a',
  partner: '#0a72d6', referral: '#d9822b', photo: '#7c5cd6', survey: '#0e7490', gap: '#e5484d',
};

/** The agent's route for the day, their stops, and a dot that replays the day. */
export default function RouteMap({ data, focus, replayIndex }: { data: AgentActivity; focus: TimelineEvent | null; replayIndex: number | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const replay = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let loaded = false;
    const map = new maplibregl.Map({ container: ref.current, style: getBasemapStyle('streets'), center: [87.55, 25.95], zoom: 8, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => { if (!loaded) setFailed(true); });
    map.on('load', () => {
      loaded = true;
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a72d6', 'line-width': 4 } });
      setReady(true);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Route + stop markers whenever the day changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const coords = data.route.map((p) => [p.lng, p.lat] as [number, number]);
    (map.getSource('route') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [],
    });
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach((c) => bounds.extend(c));
    let stop = 0;
    for (const e of data.events) {
      if (e.lat == null || e.lng == null || e.kind === 'visit_out') continue;
      const el = document.createElement('div');
      el.className = 'act-pin';
      el.style.cssText = `width:${e.kind === 'visit_in' ? 26 : 14}px;height:${e.kind === 'visit_in' ? 26 : 14}px;border-radius:999px;background:${KIND_COLOR[e.kind] ?? '#5a6478'};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);color:#fff;font:700 12px Inter,sans-serif;display:flex;align-items:center;justify-content:center;`;
      if (e.kind === 'visit_in') el.textContent = String(++stop);
      el.title = e.title;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([e.lng, e.lat]).addTo(map));
      bounds.extend([e.lng, e.lat]);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 400 });
  }, [data, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus || focus.lat == null || focus.lng == null) return;
    map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }, [focus, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const p = replayIndex != null ? data.route[replayIndex] : undefined;
    if (!p) { replay.current?.remove(); replay.current = null; return; }
    if (!replay.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:18px;height:18px;border-radius:999px;background:#0a72d6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(10,114,214,.25)';
      replay.current = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    } else {
      replay.current.setLngLat([p.lng, p.lat]);
    }
  }, [replayIndex, data, ready]);

  return (
    <div className="act-map">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} role="region" aria-label="Route map" />
      {failed && <div className="geo-map-error">The map background couldn&apos;t load. The timeline still lists everything.</div>}
      {ready && data.route.length === 0 && (
        <div style={{ position: 'absolute', left: 12, top: 12, background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
          No GPS route recorded for this day.
        </div>
      )}
    </div>
  );
}
