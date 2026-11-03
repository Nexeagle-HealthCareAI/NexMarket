'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, LocateFixed } from 'lucide-react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import type { AgentActivity, TimelineEvent } from '@/lib/crm/geo';
import { useNow } from '@/lib/crm/live';

const KIND_COLOR: Record<string, string> = {
  shift_start: '#0e1525', shift_end: '#0e1525', visit_in: '#16a36a', visit_out: '#16a36a',
  partner: '#0a72d6', referral: '#d9822b', photo: '#7c5cd6', survey: '#0e7490', gap: '#e5484d',
};
const GAP_MIN = 10;          // minutes without a GPS point: the line breaks (drawn dashed)
const ARROW_EVERY_KM = 0.8;  // a direction arrow roughly this often along the route

const t = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) - Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lng - a.lng) * Math.PI) / 180);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

type Layers = { partners: boolean; labels: boolean; times: boolean; stops: boolean };
const eventKey = (e: TimelineEvent) => `${e.kind}|${e.at}|${e.title}`;

/**
 * The agent's exact route for the day (every GPS point, in order, with direction arrows and the time on the hour),
 * where they started and finished, their stops, and a pin with the time for every partner they added.
 */
export interface LivePoint { lat: number; lng: number; at: string; accuracyM?: number | null }

export default function RouteMap({ data, focus, replayIndex, live, isToday }: {
  data: AgentActivity; focus: TimelineEvent | null; replayIndex: number | null;
  /** Fixes pushed live since the day was loaded (today only). */
  live?: LivePoint[]; isToday?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(true);
  const liveMarker = useRef<maplibregl.Marker | null>(null);
  const lastFit = useRef<string>('');
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState<Layers>({ partners: true, labels: true, times: true, stops: true });
  const markers = useRef<maplibregl.Marker[]>([]);
  const byEvent = useRef(new Map<string, maplibregl.Marker>());
  const replay = useRef<maplibregl.Marker | null>(null);

  const partners = useMemo(() => data.events.filter((e) => e.kind === 'partner'), [data.events]);
  const partnersOnMap = partners.filter((e) => e.lat != null && e.lng != null).length;

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
      map.addSource('gaps', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'gaps', type: 'line', source: 'gaps', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#e5484d', 'line-width': 3, 'line-dasharray': [1.5, 2] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a72d6', 'line-width': 4.5 } });
      map.addSource('fixes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // Every recorded GPS point, faint, so the exact trail is visible when zoomed in.
      map.addLayer({ id: 'fixes', type: 'circle', source: 'fixes', minzoom: 13, paint: { 'circle-radius': 2.5, 'circle-color': '#0a4e94', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      setReady(true);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Route, gaps, arrows, hour marks, start/end, stops and partner pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts = data.route;
    // Split the route where the phone went quiet: those stretches are drawn as a dashed red line, not as travel.
    const runs: [number, number][][] = [];
    const gaps: [number, number][][] = [];
    let run: [number, number][] = [];
    pts.forEach((p, i) => {
      if (i > 0 && (new Date(p.at).getTime() - new Date(pts[i - 1].at).getTime()) / 60000 >= GAP_MIN) {
        if (run.length > 1) runs.push(run);
        gaps.push([[pts[i - 1].lng, pts[i - 1].lat], [p.lng, p.lat]]);
        run = [];
      }
      run.push([p.lng, p.lat]);
    });
    if (run.length > 1) runs.push(run);
    (map.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: runs.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) });
    (map.getSource('gaps') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: gaps.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) });
    (map.getSource('fixes') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', properties: { at: p.at }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) });

    markers.current.forEach((m) => m.remove());
    markers.current = [];
    byEvent.current.clear();
    const bounds = new maplibregl.LngLatBounds();
    pts.forEach((p) => bounds.extend([p.lng, p.lat]));
    const add = (el: HTMLElement, lng: number, lat: number, opts?: maplibregl.MarkerOptions, popup?: string) => {
      const m = new maplibregl.Marker({ element: el, ...opts }).setLngLat([lng, lat]);
      if (popup) m.setPopup(new maplibregl.Popup({ offset: 18, closeButton: false, maxWidth: '260px' }).setHTML(popup));
      m.addTo(map);
      markers.current.push(m);
      bounds.extend([lng, lat]);
      return m;
    };

    if (layers.times && pts.length > 1) {
      // Direction arrows along the way.
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const gap = (new Date(pts[i].at).getTime() - new Date(pts[i - 1].at).getTime()) / 60000 >= GAP_MIN;
        if (gap) { acc = 0; continue; }
        acc += km(pts[i - 1], pts[i]);
        if (acc >= ARROW_EVERY_KM) {
          acc = 0;
          const el = document.createElement('div');
          el.className = 'rt-arrow';
          el.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 9 L6 2 L10 9 L6 7 Z" fill="#fff"/></svg>';
          add(el, pts[i].lng, pts[i].lat, { rotation: bearing(pts[i - 1], pts[i]), rotationAlignment: 'map' });
        }
      }
      // The time on each full hour, where the agent was then.
      let lastHour = '';
      for (const p of pts) {
        const h = new Date(p.at).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'Asia/Kolkata' });
        if (h !== lastHour && lastHour !== '') {
          const el = document.createElement('div');
          el.className = 'rt-hour';
          el.textContent = t(p.at);
          add(el, p.lng, p.lat, { anchor: 'bottom', offset: [0, -6] });
        }
        lastHour = h;
      }
    }

    // Start and finish of the day's track.
    if (pts.length > 0) {
      const first = pts[0], last = pts[pts.length - 1];
      const live = data.date === new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) && !data.events.some((e) => e.kind === 'shift_end' && e.at >= last.at);
      const flag = (cls: string, text: string, p: { lat: number; lng: number }) => {
        const el = document.createElement('div');
        el.className = `rt-flag ${cls}`;
        el.textContent = text;
        add(el, p.lng, p.lat, { anchor: 'bottom' });
      };
      flag('is-start', `Start · ${t(first.at)}`, first);
      if (pts.length > 1) flag(live ? 'is-live' : 'is-end', `${live ? 'Last seen' : 'End'} · ${t(last.at)}`, last);
    }

    // Stops: numbered, sized by time spent; green = checked in, amber = stopped without a check-in.
    const stops = (data.segments ?? []).filter((g) => g.kind === 'stop' && g.lat != null && g.lng != null);
    if (layers.stops) {
      for (const g of stops) {
        const size = Math.round(Math.min(40, 22 + g.minutes / 6));
        const el = document.createElement('div');
        el.className = 'act-pin';
        el.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;background:${g.checkedIn ? '#16a36a' : '#d9822b'};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);color:#fff;font:800 12px Inter,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;`;
        el.textContent = String(g.no);
        add(el, g.lng!, g.lat!, undefined,
          `<strong>Stop ${g.no}${g.place ? ` · ${esc(`${g.placeIsNear ? 'near ' : ''}${g.place}`)}` : ''}</strong><br/>${t(g.from)} – ${t(g.to)} · ${g.minutes} min<br/><span style="color:${g.checkedIn ? '#0b6b4a' : '#8a5100'}">${g.checkedIn ? 'Checked in' : 'No check-in'}</span>`);
      }
    }

    // Partners added: a pin with the time and name, at the spot where they were added.
    if (layers.partners) {
      partners.forEach((e, i) => {
        if (e.lat == null || e.lng == null) return;
        const approx = e.locSource === 'route';
        const name = e.name ?? e.title.replace(/^Added partner /, '');
        const el = document.createElement('div');
        el.className = `rt-partner${approx ? ' is-approx' : ''}`;
        el.innerHTML = `<span class="rt-partner-dot">${i + 1}</span>${layers.labels ? `<span class="rt-partner-label"><b>${t(e.at)}</b> ${esc(name)}</span>` : ''}`;
        el.title = `${t(e.at)} · ${name}`;
        const m = add(el, e.lng, e.lat, { anchor: 'left', offset: [-13, 0] },
          `<strong>${esc(name)}</strong><br/>Added at ${t(e.at)}${e.detail ? `<br/><span style="color:#5a6478">${esc(e.detail)}</span>` : ''}<br/><span style="color:#5a6478;font-size:12px">${approx ? 'Approximate spot: from the GPS track at that time' : 'Spot recorded by the phone'}</span>`);
        byEvent.current.set(eventKey(e), m);
      });
    }

    // Everything else that has a place: small dots (check-ins are already shown as stops).
    let visitNo = 0;
    for (const e of data.events) {
      if (e.lat == null || e.lng == null || e.kind === 'visit_out' || e.kind === 'partner' || e.kind === 'shift_start' || e.kind === 'shift_end') continue;
      if (e.kind === 'visit_in' && (stops.length > 0 || !layers.stops)) continue;
      const el = document.createElement('div');
      el.className = 'act-pin';
      el.style.cssText = `width:${e.kind === 'visit_in' ? 26 : 14}px;height:${e.kind === 'visit_in' ? 26 : 14}px;border-radius:999px;background:${KIND_COLOR[e.kind] ?? '#5a6478'};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);color:#fff;font:700 12px Inter,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;`;
      if (e.kind === 'visit_in') el.textContent = String(++visitNo);
      const m = add(el, e.lng, e.lat, undefined, `<strong>${esc(e.title)}</strong><br/>${t(e.at)}${e.detail ? `<br/><span style="color:#5a6478">${esc(e.detail)}</span>` : ''}`);
      byEvent.current.set(eventKey(e), m);
    }
    boundsRef.current = bounds.isEmpty() ? null : bounds;
    const dayKey = `${data.agent.agentId}|${data.date}`;
    if (!bounds.isEmpty() && lastFit.current !== dayKey) {
      lastFit.current = dayKey;
      map.fitBounds(bounds, { padding: { top: 80, right: 70, bottom: 50, left: 70 }, maxZoom: 15, duration: 400 });
    }
  }, [data, ready, layers, partners]);

  // Live: points the phone has sent since the page loaded extend the route, and a pulsing dot shows where they are now.
  const lastAt = data.route.length ? data.route[data.route.length - 1].at : '';
  const fresh = useMemo(() => (live ?? []).filter((p) => p.at > lastAt), [live, lastAt]);
  const latest = fresh.length ? fresh[fresh.length - 1] : (isToday && data.route.length ? data.route[data.route.length - 1] : null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!map.getSource('live')) {
      map.addSource('live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'live', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#16a36a', 'line-width': 4.5 } });
    }
    const coords = [...(data.route.length ? [data.route[data.route.length - 1]] : []), ...fresh].map((p) => [p.lng, p.lat] as [number, number]);
    (map.getSource('live') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] });
    if (!isToday || !latest) { liveMarker.current?.remove(); liveMarker.current = null; return; }
    if (!liveMarker.current) {
      const el = document.createElement('div');
      el.className = 'rt-live';
      el.innerHTML = '<span class="rt-live-ring"></span><span class="rt-live-dot"></span>';
      liveMarker.current = new maplibregl.Marker({ element: el }).setLngLat([latest.lng, latest.lat]).addTo(map);
    } else liveMarker.current.setLngLat([latest.lng, latest.lat]);
    liveMarker.current.getElement().title = `Live · ${t(latest.at)}`;
    if (follow && fresh.length) map.easeTo({ center: [latest.lng, latest.lat], duration: 600 });
  }, [fresh, latest, isToday, ready, follow, data.route]);

  // Full screen: the map grows to the whole window; Esc brings it back.
  useEffect(() => {
    const map = mapRef.current;
    const id = setTimeout(() => {
      map?.resize();
      if (map && boundsRef.current) map.fitBounds(boundsRef.current, { padding: { top: 80, right: 70, bottom: 50, left: 70 }, maxZoom: 15, duration: 300 });
    }, 80);
    if (!expanded) return () => clearTimeout(id);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(id); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [expanded]);

  // Clicking something in the timeline: fly there and open its pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus || focus.lat == null || focus.lng == null) return;
    map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
    markers.current.forEach((m) => { if (m.getPopup()?.isOpen()) m.togglePopup(); });
    const m = byEvent.current.get(eventKey(focus));
    if (m && !m.getPopup()?.isOpen()) m.togglePopup();
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

  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const now = useNow(30000);
  const ageMin = latest ? Math.round((now - new Date(latest.at).getTime()) / 60000) : null;

  return (
    <div className={`act-map-wrap${expanded ? ' is-full' : ''}`}>
      {expanded && (
        <div className="rt-full-head">
          <strong>{data.agent.name}</strong>
          <span className="crm-sub">{new Date(`${data.date}T06:30:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {data.stats.km} km · {data.stats.partners} partners added</span>
        </div>
      )}
      <div className="act-map">
        <div ref={ref} style={{ position: 'absolute', inset: 0 }} role="region" aria-label="Route map" />
        {failed && <div className="geo-map-error">The map background couldn&apos;t load. The timeline still lists everything.</div>}
        {ready && data.route.length === 0 && (
          <div style={{ position: 'absolute', left: 12, top: 12, background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
            No GPS route recorded for this day.
          </div>
        )}
        <div className="rt-tools">
          <button type="button" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? 'Exit full screen' : 'Full screen'} title={expanded ? 'Exit full screen (Esc)' : 'Full screen'}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {isToday && latest && (
            <button type="button" aria-pressed={follow} onClick={() => { setFollow((f) => !f); if (!follow && latest) mapRef.current?.easeTo({ center: [latest.lng, latest.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 500 }); }}
              title={follow ? 'Following the agent: click to stop' : 'Follow the agent'} aria-label="Follow the agent">
              <LocateFixed size={18} />
            </button>
          )}
        </div>
        {isToday && latest && (
          <div className={`rt-live-pill${ageMin != null && ageMin > 15 ? ' is-stale' : ''}`} role="status">
            <i /> {ageMin != null && ageMin <= 15 ? 'Live' : 'Last seen'} · {t(latest.at)}{ageMin != null ? ` (${ageMin < 1 ? 'just now' : `${ageMin} min ago`})` : ''}
          </div>
        )}
        <div className="rt-layers" role="group" aria-label="Show on map">
          <label><input type="checkbox" checked={layers.partners} onChange={() => toggle('partners')} /> Partners added ({partnersOnMap})</label>
          <label><input type="checkbox" checked={layers.labels} disabled={!layers.partners} onChange={() => toggle('labels')} /> Names &amp; times</label>
          <label><input type="checkbox" checked={layers.stops} onChange={() => toggle('stops')} /> Stops</label>
          <label><input type="checkbox" checked={layers.times} onChange={() => toggle('times')} /> Direction &amp; hours</label>
        </div>
      </div>
      <div className="rt-legend" aria-hidden>
        <span><i className="ln" /> Route ({data.route.length + fresh.length} GPS points)</span>
        {isToday && <span><i className="ln" style={{ background: '#16a36a' }} /> Live since you opened the page</span>}
        <span><i className="ln is-gap" /> No GPS for {GAP_MIN}+ min</span>
        <span><i className="dot" style={{ background: '#7c3aed' }} /> Partner added</span>
        <span><i className="dot is-approx" /> Approximate spot</span>
        <span><i className="dot" style={{ background: '#16a36a' }} /> Stop, checked in</span>
        <span><i className="dot" style={{ background: '#d9822b' }} /> Stop, no check-in</span>
      </div>
      {partners.length > partnersOnMap && (
        <p className="crm-cell-sub" style={{ margin: 0 }}>{partners.length - partnersOnMap} partner{partners.length - partnersOnMap === 1 ? '' : 's'} added with no location and no GPS within 15 minutes, so not on the map.</p>
      )}
    </div>
  );
}
