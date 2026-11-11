'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import { getBasemapStyle } from '@/lib/geo/mapStyle';

export interface HoardingPin { id: string; lat: number; lng: number; color: string; title: string; faded?: boolean }

const CENTER: [number, number] = [87.95, 26.1];

/** Esri World Imagery (free to show with attribution): the wall or roof itself is visible. */
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
/** Plain OpenStreetMap pictures: the fallback when the main map style can't be fetched. */
const OSM: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/**
 * Banner places as pins, coloured by where they are on the board. With `onPick` the map is choosing a spot instead:
 * a click (or dragging the pin) sets it.
 */
export default function HoardingMap({ pins, selected, onSelect, pick, onPick, height = 460, fitKey }: {
  pins: HoardingPin[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  pick?: [number, number] | null;            // [lat, lng]
  onPick?: (at: [number, number]) => void;
  height?: number;
  fitKey?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(0);
  const [sat, setSat] = useState(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pickMarker = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);
  const pinsRef = useRef(pins);
  useEffect(() => { onSelectRef.current = onSelect; onPickRef.current = onPick; pinsRef.current = pins; });

  useEffect(() => {
    if (!boxRef.current) return;
    const map = new maplibregl.Map({ container: boxRef.current, style: sat ? SATELLITE : getBasemapStyle('streets'), center: CENTER, zoom: 8, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let styled = false, fellBack = false;
    map.on('style.load', () => { styled = true; });
    // Pins are plain markers: they show even when the map pictures are slow or can't be fetched.
    setReady((n) => n + 1);
    map.on('error', () => { if (!styled && !fellBack) { fellBack = true; map.setStyle(OSM); } });
    map.on('click', (e) => onPickRef.current?.([Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6))]));
    return () => { markers.current.forEach((m) => m.remove()); markers.current = []; pickMarker.current?.remove(); pickMarker.current = null; map.remove(); mapRef.current = null; };
  }, [sat]);

  // The pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = pins.map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `hd-pin${p.id === selected ? ' is-on' : ''}${p.faded ? ' is-faded' : ''}`;
      el.style.setProperty('--pin', p.color);
      el.appendChild(document.createElement('i'));
      el.title = p.title;
      el.setAttribute('aria-label', p.title);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelectRef.current?.(p.id); });
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
    });
  }, [pins, selected, ready]);

  // The spot being chosen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!pick || !onPick) { pickMarker.current?.remove(); pickMarker.current = null; return; }
    if (!pickMarker.current) {
      const el = document.createElement('div');
      el.className = 'hd-pin is-pick';
      el.appendChild(document.createElement('i'));
      el.title = 'Drag to the exact spot';
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([pick[1], pick[0]]).addTo(map);
      m.on('dragend', () => { const p = m.getLngLat(); onPickRef.current?.([Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]); });
      pickMarker.current = m;
      map.jumpTo({ center: [pick[1], pick[0]], zoom: Math.max(map.getZoom(), 13) });
    } else pickMarker.current.setLngLat([pick[1], pick[0]]);
  }, [pick, onPick, ready]);

  // Fit to everything when asked; fly to the chosen place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const all = pinsRef.current;
    if (all.length === 0) return;
    if (all.length === 1) { map.jumpTo({ center: [all[0].lng, all[0].lat], zoom: 14 }); return; }
    const b = new maplibregl.LngLatBounds();
    all.forEach((p) => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
  }, [fitKey, ready]);
  useEffect(() => {
    const map = mapRef.current;
    const p = selected ? pinsRef.current.find((x) => x.id === selected) : null;
    if (!map || !ready || !p) return;
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }, [selected, ready]);

  return (
    <div className="hd-map" style={{ height }}>
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      <button type="button" className="hd-map-sat" aria-pressed={sat} onClick={() => setSat((v) => !v)}>{sat ? 'Street map' : 'Satellite'}</button>
    </div>
  );
}
