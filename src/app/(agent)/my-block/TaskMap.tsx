'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import { getDirections, type AssignmentPanchayatDto, type DirectionsDto } from '@/lib/sync/api-client';
import { haversineDistanceMeters, bearingDegrees, compassLabel, formatDistance } from '@/lib/geo/distance';

interface TaskMapProps {
  panchayats: AssignmentPanchayatDto[];
  selectedPanchayatId: string | null;
  onSelectPanchayat: (id: string | null) => void;
  position: { lat: number; lng: number } | null;
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

export default function TaskMap({ panchayats, selectedPanchayatId, onSelectPanchayat, position }: TaskMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasLoadedRef = useRef(false);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const ownMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  const located = panchayats.filter(
    (p): p is AssignmentPanchayatDto & { centroidLat: number; centroidLng: number } =>
      p.centroidLat != null && p.centroidLng != null,
  );
  const selected = selectedPanchayatId ? located.find((p) => p.panchayatId === selectedPanchayatId) ?? null : null;

  const [route, setRoute] = useState<DirectionsDto | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeIsFallback, setRouteIsFallback] = useState(false);
  const lastRouteFetchRef = useRef<{ position: { lat: number; lng: number }; selectedId: string } | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBasemapStyle(),
      center: [87.5701, 25.5541],
      zoom: 9,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

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

  // Marker cleanup on unmount
  useEffect(() => {
    return () => {
      if (ownMarkerRef.current) {
        ownMarkerRef.current.remove();
        ownMarkerRef.current = null;
      }
    };
  }, []);

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
            `<div class="p-1 font-sans">
              <strong class="text-sm">${p.name}</strong><br/>
              <span class="text-xs ${p.visited ? 'text-emerald-500' : 'text-amber-700'}">${p.visited ? '✅ Visited' : '⏳ Pending'}</span>
            </div>`
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
  }, [mapLoaded, located.map((p) => p.panchayatId).join(','), selectedPanchayatId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !position) return;

    if (!ownMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-[0_0_10px_rgba(59,130,246,0.8)]';
      ownMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(map);
    } else {
      ownMarkerRef.current.setLngLat([position.lng, position.lat]);
    }
  }, [position, mapLoaded]);

  useEffect(() => {
    if (!selected || !position) {
      setRoute(null);
      setRouteIsFallback(false);
      lastRouteFetchRef.current = null;
      return;
    }

    const distFromLastFetch = lastRouteFetchRef.current?.position 
      ? haversineDistanceMeters(position, lastRouteFetchRef.current.position) 
      : Infinity;

    // Only refetch if selected changed OR moved more than 50 meters
    if (lastRouteFetchRef.current?.selectedId === selected.panchayatId && distFromLastFetch < 50) {
      return;
    }

    lastRouteFetchRef.current = { position, selectedId: selected.panchayatId };
    
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
        if (cancelled) return;
        setRoute(null);
        setRouteIsFallback(true);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => { cancelled = true; };
  }, [selected?.panchayatId, position]);

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
    <div className={`relative rounded-md overflow-hidden border border-[var(--surface-border)] mb-5 transition-all duration-200 ${selected ? 'h-80' : 'h-64'}`}>
      <div ref={mapContainerRef} className="w-full h-full" />

      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/85 text-white text-center p-4 z-[5]">
          <p className="text-xs">🗺️ Map unavailable right now — your task list below still works.</p>
        </div>
      )}

      {located.length === 0 && !mapError && (
        <div className="absolute bottom-2 left-2 right-2 bg-white/90 rounded p-2 text-xs text-slate-500 z-[5]">
          No location data yet for these panchayats.
        </div>
      )}

      {selected && (
        <div className="absolute bottom-2 left-2 right-2 bg-white rounded-md p-3 shadow-lg z-[6]">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold text-[var(--text-primary)] truncate">
                📍 {selected.name}
              </p>
              {!position ? (
                <p className="mt-1 text-xs text-[var(--text-muted)]">Waiting for your GPS fix…</p>
              ) : routeLoading ? (
                <p className="mt-1 text-xs text-[var(--text-muted)]">Finding route…</p>
              ) : route ? (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)} by road
                </p>
              ) : fallbackDistance != null && fallbackBearing != null ? (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  ≈ {formatDistance(fallbackDistance)} {compassLabel(fallbackBearing)}
                  {routeIsFallback ? ' — straight line, no live route' : ''}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onSelectPanchayat(null)}
              aria-label="Clear route"
              className="bg-transparent border-none text-[var(--text-muted)] text-base cursor-pointer p-0.5 shrink-0"
            >
              ✕
            </button>
          </div>
          <a
            href={navigationUrl(selected.centroidLat, selected.centroidLng)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 mt-2.5 bg-blue-500 text-white font-bold text-xs p-2 rounded-sm no-underline"
          >
            🧭 Start Navigation
          </a>
        </div>
      )}
    </div>
  );
}
