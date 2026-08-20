'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import { getDirections, type AssignmentPanchayatDto, type DirectionsDto } from '@/lib/sync/api-client';
import { haversineDistanceMeters, bearingDegrees, compassLabel, formatDistance } from '@/lib/geo/distance';

interface TaskMapProps {
  panchayats: AssignmentPanchayatDto[];
  selectedPanchayatId: string | null;
  onSelectPanchayat: (id: string | null) => void;
}

const ROUTE_SOURCE_ID = 'task-route';
const ROUTE_LAYER_ID = 'task-route-line';

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function navigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export default function TaskMap({ panchayats, selectedPanchayatId, onSelectPanchayat }: TaskMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasLoadedRef = useRef(false);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
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
  const selected = selectedPanchayatId ? located.find((p) => p.panchayatId === selectedPanchayatId) ?? null : null;

  // Premium "route to this panchayat" — a real routed path (Mapbox Directions,
  // proxied + cached server-side) when reachable, with an instant straight-
  // line distance/bearing shown immediately and kept as the fallback if the
  // routed fetch fails or there's no connectivity. Ola/Zepto-style: this app
  // draws the route preview, "Start Navigation" hands off to the phone's own
  // maps app for the actual turn-by-turn voice guidance — building that
  // in-house is a different, much bigger project than a route preview.
  const [route, setRoute] = useState<DirectionsDto | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeIsFallback, setRouteIsFallback] = useState(false);

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

  // Panchayat pins — green if visited, amber if pending, ring highlight if
  // selected for routing. Tapping a pin selects it (tap again to clear).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = new Map();

    if (located.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    located.forEach((p) => {
      const isSelected = p.panchayatId === selectedPanchayatId;
      const el = document.createElement('div');
      el.style.width = isSelected ? '22px' : '16px';
      el.style.height = isSelected ? '22px' : '16px';
      el.style.borderRadius = '50%';
      el.style.background = p.visited ? '#10b981' : '#f59e0b';
      el.style.border = isSelected ? '3px solid #3b82f6' : '2px solid #fff';
      el.style.boxShadow = isSelected ? '0 0 0 4px rgba(59,130,246,0.25)' : '0 1px 4px rgba(0,0,0,0.4)';
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => onSelectPanchayat(isSelected ? null : p.panchayatId));

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

      markersRef.current.set(p.panchayatId, marker);
      bounds.extend([p.centroidLng, p.centroidLat]);
    });

    if (position) bounds.extend([position.lng, position.lat]);

    if (located.length === 1 && !position) {
      map.flyTo({ center: [located[0].centroidLng, located[0].centroidLat], zoom: 12 });
    } else {
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
    }
    // Only refit when the panchayat set or selection changes, not on every
    // GPS tick — otherwise the map would keep re-centering under the agent's
    // thumb while they're just standing still waiting for a fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, located.map((p) => p.panchayatId).join(','), selectedPanchayatId]);

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

  // Fetch (and cache-bust on reselect) the route whenever the selected
  // panchayat or current position meaningfully changes.
  useEffect(() => {
    if (!selected || !position) {
      setRoute(null);
      setRouteIsFallback(false);
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    setRouteIsFallback(false);

    getDirections(
      { lat: position.lat, lng: position.lng },
      { lat: selected.centroidLat, lng: selected.centroidLng },
    )
      .then((result) => {
        if (cancelled) return;
        setRoute(result);
        setRouteIsFallback(false);
      })
      .catch(() => {
        // Offline, Mapbox unreachable, or no route found — the straight-line
        // distance/bearing (computed below from `position`/`selected`
        // directly) is what renders in this case; nothing routed to draw.
        if (cancelled) return;
        setRoute(null);
        setRouteIsFallback(true);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => { cancelled = true; };
    // Re-fetch on every GPS tick would spam the API for a slowly-drifting
    // position — round to ~100m so only a meaningfully different starting
    // point (or a different destination) triggers a new fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.panchayatId, position ? Math.round(position.lat * 1000) : null, position ? Math.round(position.lng * 1000) : null]);

  // Draw/clear the route line on the map. A LineString needs >= 2 positions
  // to be valid GeoJSON — clearing the route removes the layer/source
  // entirely rather than feeding it an empty coordinates array, which
  // maplibre chokes on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const hasRoute = !!route && route.geometry.length > 1;

    if (!hasRoute) {
      if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
      if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
      return;
    }

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: route!.geometry },
    };

    const existingSource = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geojson });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.85 },
      });
    }

    const bounds = route!.geometry.reduce(
      (b, [lng, lat]) => b.extend([lng, lat]),
      new maplibregl.LngLatBounds(route!.geometry[0], route!.geometry[0]),
    );
    map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 300 });
  }, [route, mapLoaded]);

  const fallbackDistance = selected && position
    ? haversineDistanceMeters(position, { lat: selected.centroidLat, lng: selected.centroidLng })
    : null;
  const fallbackBearing = selected && position
    ? bearingDegrees(position, { lat: selected.centroidLat, lng: selected.centroidLng })
    : null;

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)', height: selected ? '320px' : '260px', marginBottom: '1.25rem', transition: 'height 0.2s' }}>
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

      {/* Route preview card */}
      {selected && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'white', borderRadius: 'var(--radius-md)', padding: '0.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', zIndex: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📍 {selected.name}
              </p>
              {!position ? (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Waiting for your GPS fix…</p>
              ) : routeLoading ? (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Finding route…</p>
              ) : route ? (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)} by road
                </p>
              ) : fallbackDistance != null && fallbackBearing != null ? (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  ≈ {formatDistance(fallbackDistance)} {compassLabel(fallbackBearing)}
                  {routeIsFallback ? ' — straight line, no live route' : ''}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onSelectPanchayat(null)}
              aria-label="Clear route"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1rem', cursor: 'pointer', padding: '0.1rem 0.3rem', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
          <a
            href={navigationUrl(selected.centroidLat, selected.centroidLng)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              marginTop: '0.6rem', background: '#3b82f6', color: 'white', fontWeight: 700, fontSize: '0.82rem',
              padding: '0.55rem', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
            }}
          >
            🧭 Start Navigation
          </a>
        </div>
      )}
    </div>
  );
}
