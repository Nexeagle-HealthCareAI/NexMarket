'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import { Empty, Skeleton } from '@/components/crm/ui';

/**
 * Panchayats shaded by a value: the outline where we have one, otherwise a dot at its centre.
 * The caller works out each panchayat's colour; this draws it, shows a hover tip, and reports clicks.
 */
export interface ChoroplethItem {
  id: string; lgd?: string | null; lat?: number | null; lng?: number | null;
  color: string; faint?: boolean; hidden?: boolean; name: string; tip: string;
}

export const NO_DATA = '#dcdbd6';
const CENTER: [number, number] = [87.55, 25.95];
type FC = GeoJSON.FeatureCollection;

export default function PanchayatChoropleth({ items, selected, onSelect, fitKey, focus, label, children }: {
  items: ChoroplethItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Changes when the area filter changes: the map then zooms to the panchayats shown. '' = whole region. */
  fitKey: string;
  /** Pan to this panchayat (bump n to repeat). */
  focus?: { id: string; n: number } | null;
  label: string;
  children?: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [areaIds, setAreaIds] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const lookup = useRef<(id: string) => ChoroplethItem | null>(() => null);
  const selectRef = useRef(onSelect);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    let loaded = false;
    const map = new maplibregl.Map({ container: boxRef.current, style: getBasemapStyle('light'), center: CENTER, zoom: 7.6, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => { if (!loaded) { console.error('Map error', e.error); setMapError(true); } });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'svm-tip' });
    let tipKey = '';

    map.on('load', async () => {
      loaded = true;
      const empty: FC = { type: 'FeatureCollection', features: [] };
      map.addSource('blocks', { type: 'geojson', data: '/data/seemanchal_blocks.geojson' });
      map.addSource('areas', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addSource('points', { type: 'geojson', data: empty, promoteId: 'id' });
      const fill: maplibregl.ExpressionSpecification = ['coalesce', ['feature-state', 'c'], NO_DATA];
      const hidden: maplibregl.ExpressionSpecification = ['boolean', ['feature-state', 'hidden'], true];
      const faint: maplibregl.ExpressionSpecification = ['boolean', ['feature-state', 'faint'], false];
      const sel: maplibregl.ExpressionSpecification = ['boolean', ['feature-state', 'sel'], false];
      map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': fill, 'fill-opacity': ['case', hidden, 0, faint, 0.38, 0.82] } });
      map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: {
        'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 1.5], 'line-opacity': ['case', hidden, 0, 1],
      } });
      map.addLayer({ id: 'areas-sel', type: 'line', source: 'areas', paint: { 'line-color': '#0e1525', 'line-width': 3, 'line-opacity': ['case', sel, 1, 0] } });
      map.addLayer({ id: 'blocks-line', type: 'line', source: 'blocks', paint: {
        'line-color': '#0e1525', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 11, 2], 'line-opacity': 0.5, 'line-dasharray': [3, 2],
      } });
      map.addLayer({ id: 'points', type: 'circle', source: 'points', paint: {
        'circle-color': fill,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4, 11, 9],
        'circle-stroke-color': ['case', sel, '#0e1525', '#ffffff'],
        'circle-stroke-width': ['case', sel, 3, 1.5],
        'circle-opacity': ['case', hidden, 0, faint, 0.45, 0.95],
        'circle-stroke-opacity': ['case', hidden, 0, 1],
      } });
      try {
        map.addLayer({ id: 'block-labels', type: 'symbol', source: 'blocks', maxzoom: 10.5,
          layout: { 'text-field': ['get', 'block'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
          paint: { 'text-color': '#0e1525', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
        map.addLayer({ id: 'area-labels', type: 'symbol', source: 'areas', minzoom: 10.5,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
          paint: { 'text-color': '#1a2236', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      } catch { /* a style without fonts: no labels */ }

      for (const layer of ['areas-fill', 'points']) {
        map.on('click', layer, (e) => {
          const it = lookup.current(String(e.features?.[0]?.properties?.id ?? ''));
          if (it) selectRef.current(it.id);
        });
        map.on('mousemove', layer, (e) => {
          const it = lookup.current(String(e.features?.[0]?.properties?.id ?? ''));
          if (!it || it.hidden) { popup.remove(); tipKey = ''; map.getCanvas().style.cursor = ''; return; }
          map.getCanvas().style.cursor = 'pointer';
          const key = `${it.id}|${it.tip}`;
          if (key !== tipKey) {
            tipKey = key;
            const el = document.createElement('div');
            const b = document.createElement('strong'); b.textContent = it.name;
            const s = document.createElement('span'); s.textContent = it.tip;
            el.append(b, s);
            popup.setDOMContent(el);
          }
          popup.setLngLat(e.lngLat).addTo(map);
        });
        map.on('mouseleave', layer, () => { popup.remove(); tipKey = ''; map.getCanvas().style.cursor = ''; });
      }
      try {
        const fc = (await (await fetch('/data/panchayat-areas.geojson')).json()) as FC;
        setAreaIds(new Set(fc.features.map((f) => String(f.properties?.id))));
        (map.getSource('areas') as maplibregl.GeoJSONSource).setData(fc);
      } catch { /* outlines are a bonus; points still show every panchayat */ }
      setReady(true);
    });
    return () => { popup.remove(); map.remove(); mapRef.current = null; };
  }, []);

  // The outlines are keyed by LGD code; panchayats may be keyed by their own id.
  const shapeOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const it of items) m.set(it.id, areaIds.has(it.id) ? it.id : it.lgd && areaIds.has(it.lgd) ? it.lgd : null);
    return m;
  }, [items, areaIds]);

  useEffect(() => {
    const byKey = new Map<string, ChoroplethItem>();
    for (const it of items) { byKey.set(it.id, it); const s = shapeOf.get(it.id); if (s) byKey.set(s, it); }
    lookup.current = (k) => byKey.get(k) ?? null;
    selectRef.current = onSelect;
  }, [items, shapeOf, onSelect]);

  // Points for panchayats without an outline (only when the set of panchayats changes).
  const pointKey = ready ? items.filter((it) => !shapeOf.get(it.id) && it.lat != null && it.lng != null).map((it) => it.id).join(',') : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts: FC = { type: 'FeatureCollection', features: items.filter((it) => !shapeOf.get(it.id) && it.lat != null && it.lng != null).map((it) => ({
      type: 'Feature', properties: { id: it.id, name: it.name }, geometry: { type: 'Point', coordinates: [it.lng!, it.lat!] },
    })) };
    (map.getSource('points') as maplibregl.GeoJSONSource).setData(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pointKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const apply = () => {
      for (const it of items) {
        const s = shapeOf.get(it.id);
        map.setFeatureState({ source: s ? 'areas' : 'points', id: s ?? it.id }, { c: it.color, faint: !!it.faint, hidden: !!it.hidden, sel: it.id === selected });
      }
    };
    apply();
    map.once('idle', apply); // new point features exist only once setData is processed
  }, [ready, items, shapeOf, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts = items.filter((it) => !it.hidden && it.lat != null && it.lng != null);
    if (!fitKey || !pts.length) { map.easeTo({ center: CENTER, zoom: 7.6, duration: 600 }); return; }
    const b = new maplibregl.LngLatBounds();
    for (const it of pts) b.extend([it.lng!, it.lat!]);
    map.fitBounds(b, { padding: 60, maxZoom: 11, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    const it = focus ? items.find((x) => x.id === focus.id) : null;
    if (!map || !it || it.lat == null || it.lng == null) return;
    map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 10.5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, focus?.n]);

  return (
    <section className="crm-card grow-3 svm-mapcard" aria-label={label}>
      <div className="svm-map" ref={boxRef} />
      {!ready && !mapError && <div className="svm-cover"><Skeleton h={40} /></div>}
      {mapError && <div className="svm-cover"><Empty title="The map didn't load">Check the internet connection and reload. The list beside it still works.</Empty></div>}
      {children}
    </section>
  );
}
