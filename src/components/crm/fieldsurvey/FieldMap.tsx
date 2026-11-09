'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import { getBasemapStyle } from '@/lib/geo/mapStyle';

export interface FieldTrack { id: string; color: string; points: [number, number][] }
export interface FieldSpot { id: string; lat: number; lng: number; color: string; title: string }

const CENTER: [number, number] = [87.95, 26.1];
type FC = GeoJSON.FeatureCollection;
const empty: FC = { type: 'FeatureCollection', features: [] };

/** Esri World Imagery (free to show with attribution): roofs, chowks and lanes are visible when drawing the area. */
const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri' },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};

/** Plain OpenStreetMap pictures: the fallback when the main map style can't be fetched. */
const OSM: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function areaGeo(ring: [number, number][]): FC {
  if (ring.length < 2) return empty;
  const closed = ring.length >= 3 ? [...ring, ring[0]] : ring;
  return {
    type: 'FeatureCollection',
    features: [
      ...(ring.length >= 3 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [closed] } }] : []),
      { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: closed } },
    ],
  };
}

/**
 * The map for occasional field surveys. In draw mode a click adds a corner of the area and corners can be dragged;
 * otherwise it shows the area, the traced routes (coloured by road type) and the marked spots.
 */
export default function FieldMap({ area, onArea, tracks = [], spots = [], onSpot, height = 520, fitKey }: {
  area: [number, number][];
  /** Draw mode when given. */
  onArea?: (ring: [number, number][]) => void;
  tracks?: FieldTrack[];
  spots?: FieldSpot[];
  onSpot?: (id: string) => void;
  height?: number;
  /** Re-fit the view when this changes. */
  fitKey?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(0);
  const [sat, setSat] = useState(false);
  const cornersRef = useRef<maplibregl.Marker[]>([]);
  const spotMarkers = useRef<maplibregl.Marker[]>([]);
  const areaRef = useRef(area);
  const onAreaRef = useRef(onArea);
  const onSpotRef = useRef(onSpot);
  useEffect(() => { areaRef.current = area; onAreaRef.current = onArea; onSpotRef.current = onSpot; });

  // Create the map (and re-create the layers when the base style changes).
  useEffect(() => {
    if (!boxRef.current) return;
    const map = new maplibregl.Map({ container: boxRef.current, style: sat ? SATELLITE : getBasemapStyle('streets'), center: CENTER, zoom: 8, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let styled = false, fellBack = false;
    // Layers go on every style load (the style can be swapped for the fallback below).
    map.on('style.load', () => {
      styled = true;
      if (map.getSource('fs-area')) return;
      map.addSource('fs-area', { type: 'geojson', data: empty });
      map.addSource('fs-tracks', { type: 'geojson', data: empty });
      map.addLayer({ id: 'fs-area-fill', type: 'fill', source: 'fs-area', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0a72d6', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'fs-area-line', type: 'line', source: 'fs-area', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#0a72d6', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'fs-tracks-casing', type: 'line', source: 'fs-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
      map.addLayer({ id: 'fs-tracks', type: 'line', source: 'fs-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
      setReady((n) => n + 1);
    });
    map.on('error', () => { if (!styled && !fellBack) { fellBack = true; map.setStyle(OSM); } });
    map.on('click', (e) => {
      const cb = onAreaRef.current;
      if (!cb) return;
      cb([...areaRef.current, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]]);
    });
    return () => { cornersRef.current.forEach((m) => m.remove()); spotMarkers.current.forEach((m) => m.remove()); map.remove(); mapRef.current = null; };
  }, [sat]);

  // Area and corner handles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('fs-area') as maplibregl.GeoJSONSource | undefined)?.setData(areaGeo(area));
    cornersRef.current.forEach((m) => m.remove());
    cornersRef.current = [];
    if (!onArea) return;
    area.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'fs-corner';
      el.title = 'Drag to move this corner';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(c).addTo(map);
      m.on('dragend', () => {
        const p = m.getLngLat();
        const next = [...areaRef.current];
        next[i] = [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
        onAreaRef.current?.(next);
      });
      el.addEventListener('click', (ev) => ev.stopPropagation());
      cornersRef.current.push(m);
    });
  }, [area, onArea, ready]);

  // Routes and spots.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('fs-tracks') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: tracks.filter((t) => t.points.length > 1).map((t) => ({ type: 'Feature', properties: { color: t.color }, geometry: { type: 'LineString', coordinates: t.points.map(([lat, lng]) => [lng, lat]) } })),
    });
    spotMarkers.current.forEach((m) => m.remove());
    spotMarkers.current = spots.map((s) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'fs-spot';
      el.style.background = s.color;
      el.title = s.title;
      el.setAttribute('aria-label', s.title);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); onSpotRef.current?.(s.id); });
      return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }, [tracks, spots, ready]);

  // Fit to what there is to see.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const b = new maplibregl.LngLatBounds();
    let any = false;
    areaRef.current.forEach((c) => { b.extend(c); any = true; });
    tracks.forEach((t) => t.points.forEach(([lat, lng]) => { b.extend([lng, lat]); any = true; }));
    spots.forEach((s) => { b.extend([s.lng, s.lat]); any = true; });
    if (any) map.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the caller says the subject changed (and once the map is ready)
  }, [fitKey, ready]);

  return (
    <div className="fs-map" style={{ height }}>
      <div ref={boxRef} className="fs-map-box" />
      <div className="fs-map-tools">
        <button type="button" className="crm-chip" aria-pressed={!sat} onClick={() => setSat(false)}>Map</button>
        <button type="button" className="crm-chip" aria-pressed={sat} onClick={() => setSat(true)}>Satellite</button>
      </div>
    </div>
  );
}
