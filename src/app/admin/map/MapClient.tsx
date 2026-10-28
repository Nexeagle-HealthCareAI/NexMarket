'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from '@/lib/geo/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Activity, Phone, X } from 'lucide-react';
import { getBasemapStyle } from '@/lib/geo/mapStyle';
import { canEdit, useAccess } from '@/lib/crm/access';
import { timeAgo, useLiveEvents, useNow, type LiveEvent, type LiveLocation } from '@/lib/crm/live';
import {
  AGENT_STATUS_META, geo, istDate, STATUS_META,
  type CoverageRow, type CoverageStatus, type LiveAgent, type PanchayatDetail,
} from '@/lib/crm/geo';
import PanchayatPanel from '@/components/crm/geo/PanchayatPanel';
import { Empty, ErrorBox, fmt, friendlyError, initials, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

const PERIODS = [
  { key: '1', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];
const STATUSES: CoverageStatus[] = ['patients', 'partners', 'visited', 'untouched'];
const SEEMANCHAL_CENTER: [number, number] = [87.55, 25.95];

type Selection = { type: 'panchayat'; id: string } | { type: 'agent'; id: string } | null;
type FC = GeoJSON.FeatureCollection;

const statusColor: maplibregl.ExpressionSpecification = [
  'match', ['coalesce', ['feature-state', 'status'], 'untouched'],
  'patients', STATUS_META.patients.color,
  'partners', STATUS_META.partners.color,
  'visited', STATUS_META.visited.color,
  STATUS_META.untouched.color,
];

export default function MapClient() {
  const params = useSearchParams();
  const { access } = useAccess();
  const canEditField = canEdit(access, 'field');
  const canEditPartners = canEdit(access, 'partners');
  const [toast, showToast] = useToast();
  const now = useNow(30000);

  // ─── Filters ────────────────────────────────────────────────────────────
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [shown, setShown] = useState<Record<CoverageStatus, boolean>>({ patients: true, partners: true, visited: true, untouched: true });
  const [showAgents, setShowAgents] = useState(true);
  const from = istDate(Number(period) - 1);
  const to = istDate(0);

  const coverage = useLoader(() => geo.coverage({ agentId: agentFilter || undefined, from, to }), [agentFilter, from, to]);
  const live = useLoader(() => geo.live(), []);

  const initial: Selection = params.get('panchayat') ? { type: 'panchayat', id: params.get('panchayat')! }
    : params.get('agentId') ? { type: 'agent', id: params.get('agentId')! } : null;
  const [selected, setSelected] = useState<Selection>(initial);
  const [panelVersion, setPanelVersion] = useState(0);
  const [pinEdit, setPinEdit] = useState<{ id: string; name: string; lat: number; lng: number } | null>(null);
  const [savingPin, setSavingPin] = useState(false);

  // Live GPS pushed between refreshes: agentId → newest fix.
  const [fixes, setFixes] = useState<Record<string, LiveLocation>>({});
  const [pinged, setPinged] = useState<Record<string, number>>({});

  const rows = useMemo(() => coverage.data?.items ?? [], [coverage.data]);
  const districts = useMemo(() => [...new Set(rows.map((r) => r.district))].sort(), [rows]);
  const blocks = useMemo(() => [...new Set(rows.filter((r) => !district || r.district === district).map((r) => r.block))].sort(), [rows, district]);
  const visibleRows = useMemo(() => rows.filter((r) => (!district || r.district === district) && (!block || r.block === block)), [rows, district, block]);
  const counts = useMemo(() => {
    const c: Record<CoverageStatus, number> = { patients: 0, partners: 0, visited: 0, untouched: 0 };
    for (const r of visibleRows) c[r.status]++;
    return c;
  }, [visibleRows]);

  const agents: LiveAgent[] = useMemo(() => (live.data?.agents ?? []).map((a) => {
    const f = fixes[a.agentId];
    if (f && (!a.at || new Date(f.at) > new Date(a.at))) {
      return { ...a, lat: f.lat, lng: f.lng, at: f.at, minutesSinceSeen: 0, status: a.status === 'no_signal' ? 'moving' : a.status };
    }
    return a;
  }), [live.data, fixes]);

  // ─── Live updates ───────────────────────────────────────────────────────
  const coverageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useCallback((e: LiveEvent) => {
    if (['shift', 'visit'].includes(e.kind)) void live.reload();
    if (['visit', 'partner', 'referral'].includes(e.kind)) {
      if (coverageTimer.current) clearTimeout(coverageTimer.current);
      coverageTimer.current = setTimeout(() => void coverage.reload(), 4000);
    }
  }, [live, coverage]);
  const onLocation = useCallback((l: LiveLocation) => {
    setFixes((f) => ({ ...f, [l.agentId]: l }));
    setPinged((p) => ({ ...p, [l.agentId]: Date.now() }));
  }, []);
  const liveStatus = useLiveEvents(onEvent, onLocation);

  useEffect(() => {
    const t = setInterval(() => void live.reload(), 30000);
    const c = setInterval(() => void coverage.reload(), 120000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [live, coverage]);

  // ─── Map ────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const areaIds = useRef<Set<string>>(new Set());
  const [areasLoaded, setAreasLoaded] = useState(0);
  const agentMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const pinMarker = useRef<maplibregl.Marker | null>(null);
  // setSelected is stable, so map event handlers registered once can call it safely.
  const selectRef = useRef<(s: Selection) => void>(setSelected);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let loaded = false;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyle('light'),
      center: SEEMANCHAL_CENTER,
      zoom: 7.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => { if (!loaded) { console.error('Map error', e.error); setMapError(true); } });

    map.on('load', async () => {
      loaded = true;
      const empty: FC = { type: 'FeatureCollection', features: [] };
      map.addSource('blocks', { type: 'geojson', data: '/data/seemanchal_blocks.geojson' });
      map.addSource('areas', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addSource('points', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addSource('trails', { type: 'geojson', data: empty });

      map.addLayer({
        id: 'areas-fill', type: 'fill', source: 'areas',
        paint: {
          'fill-color': statusColor,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, ['boolean', ['feature-state', 'selected'], false], 0.85, 0.55],
        },
      });
      map.addLayer({
        id: 'areas-line', type: 'line', source: 'areas',
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 1.5], 'line-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 0.9] },
      });
      map.addLayer({
        id: 'areas-selected', type: 'line', source: 'areas',
        paint: { 'line-color': '#0e1525', 'line-width': 3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] },
      });
      map.addLayer({
        id: 'blocks-line', type: 'line', source: 'blocks',
        paint: { 'line-color': '#0e1525', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 11, 2], 'line-opacity': 0.55, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'points', type: 'circle', source: 'points',
        paint: {
          'circle-color': statusColor,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 11, 7],
          'circle-stroke-color': ['case', ['==', ['get', 'source'], 'block'], '#8a93a6', '#ffffff'],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 0.95],
          'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 1],
        },
      });
      map.addLayer({
        id: 'trails', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.75 },
      });
      try {
        map.addLayer({
          id: 'block-labels', type: 'symbol', source: 'blocks', maxzoom: 10.5,
          layout: { 'text-field': ['get', 'block'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': false },
          paint: { 'text-color': '#0e1525', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
        });
        map.addLayer({
          id: 'area-labels', type: 'symbol', source: 'areas', minzoom: 10.5,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
          paint: { 'text-color': '#1a2236', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
        });
      } catch { /* a style without fonts: no labels, everything else works */ }

      const pick = (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) selectRef.current({ type: 'panchayat', id });
      };
      for (const layer of ['areas-fill', 'points']) {
        map.on('click', layer, pick);
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      try {
        const res = await fetch('/data/panchayat-areas.geojson');
        const fc = (await res.json()) as FC;
        areaIds.current = new Set(fc.features.map((f) => String(f.properties?.id)));
        (map.getSource('areas') as maplibregl.GeoJSONSource).setData(fc);
        setAreasLoaded((n) => n + 1);
      } catch { /* outlines are a bonus; points still show every panchayat */ }
      setMapReady(true);
    });

    const markers = agentMarkers.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Coverage → colours, points for panchayats without an outline, visibility filters.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const points: FC = {
      type: 'FeatureCollection',
      features: rows.filter((r) => r.lat != null && r.lng != null && !areaIds.current.has(r.id)).map((r) => ({
        type: 'Feature',
        properties: { id: r.id, name: r.name, source: r.source },
        geometry: { type: 'Point', coordinates: [r.lng!, r.lat!] },
      })),
    };
    (map.getSource('points') as maplibregl.GeoJSONSource).setData(points);
    const apply = () => {
      for (const r of rows) {
        const hidden = !shown[r.status] || (!!district && r.district !== district) || (!!block && r.block !== block);
        const src = areaIds.current.has(r.id) ? 'areas' : 'points';
        map.setFeatureState({ source: src, id: r.id }, { status: r.status, hidden });
      }
    };
    // setData on points is async; apply now (areas) and again once points are in.
    apply();
    const t = setTimeout(apply, 250);
    return () => clearTimeout(t);
  }, [rows, shown, district, block, mapReady, areasLoaded]);

  // Fit the map to the chosen district / block.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || (!district && !block)) return;
    const pts = visibleRows.filter((r) => r.lat != null && r.lng != null);
    if (pts.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((r) => b.extend([r.lng!, r.lat!]));
    map.fitBounds(b, { padding: 70, maxZoom: 12, duration: 600 });
  }, [district, block, mapReady, visibleRows]);

  // Highlight + fly to the selected panchayat.
  const hasRows = rows.length > 0;
  const hasAgents = agents.length > 0;
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (lastSelected.current) {
      const prev = lastSelected.current;
      map.setFeatureState({ source: areaIds.current.has(prev) ? 'areas' : 'points', id: prev }, { selected: false });
      lastSelected.current = null;
    }
    if (selected?.type === 'panchayat') {
      const r = rows.find((x) => x.id === selected.id);
      map.setFeatureState({ source: areaIds.current.has(selected.id) ? 'areas' : 'points', id: selected.id }, { selected: true });
      lastSelected.current = selected.id;
      if (r?.lat != null && r.lng != null) map.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
    }
    if (selected?.type === 'agent') {
      const a = agents.find((x) => x.agentId === selected.id);
      if (a?.lat != null && a.lng != null) map.easeTo({ center: [a.lng, a.lat], zoom: Math.max(map.getZoom(), 11.5), duration: 600 });
    }
    // agents/rows change every refresh; only re-centre when the selection itself changes
    // (or when the data it needs first arrives)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mapReady, areasLoaded, hasRows, hasAgents]);

  // Agent markers + their recent trail.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const seen = new Set<string>();
    const trails: FC = { type: 'FeatureCollection', features: [] };
    for (const a of agents) {
      if (!showAgents || a.lat == null || a.lng == null || a.status === 'off_shift') continue;
      if (agentFilter && a.agentId !== agentFilter) continue;
      seen.add(a.agentId);
      const color = AGENT_STATUS_META[a.status].color;
      let m = agentMarkers.current.get(a.agentId);
      if (!m) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'geo-agent';
        el.textContent = initials(a.name);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); selectRef.current({ type: 'agent', id: a.agentId }); });
        m = new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map);
        agentMarkers.current.set(a.agentId, m);
      } else {
        m.setLngLat([a.lng, a.lat]);
      }
      const el = m.getElement();
      el.style.setProperty('--c', color);
      el.title = `${a.name} — ${AGENT_STATUS_META[a.status].label}${a.currentPlace ? ` at ${a.currentPlace}` : ''}`;
      el.setAttribute('aria-label', el.title);
      el.classList.toggle('is-stale', a.status === 'no_signal');
      el.classList.toggle('is-selected', selected?.type === 'agent' && selected.id === a.agentId);
      if (pinged[a.agentId] && Date.now() - pinged[a.agentId] < 3000) {
        el.classList.remove('is-ping');
        void el.offsetWidth; // restart the animation
        el.classList.add('is-ping');
      }
      if (a.trail.length > 1) {
        trails.features.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: a.trail } });
      }
    }
    for (const [id, m] of agentMarkers.current) {
      if (!seen.has(id)) { m.remove(); agentMarkers.current.delete(id); }
    }
    (map.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trails);
  }, [agents, showAgents, agentFilter, mapReady, selected, pinged]);

  // Pin editing: a draggable pin the admin drops on the real spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinEdit) return;
    const el = document.createElement('div');
    el.className = 'geo-pin-edit';
    el.setAttribute('aria-label', `New location for ${pinEdit.name}`);
    const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom-left' }).setLngLat([pinEdit.lng, pinEdit.lat]).addTo(map);
    m.on('dragend', () => {
      const p = m.getLngLat();
      setPinEdit((cur) => (cur ? { ...cur, lat: p.lat, lng: p.lng } : cur));
    });
    pinMarker.current = m;
    map.easeTo({ center: [pinEdit.lng, pinEdit.lat], zoom: Math.max(map.getZoom(), 12.5), duration: 500 });
    return () => { m.remove(); pinMarker.current = null; };
    // the marker is created once per edit session (id), not on every drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinEdit?.id]);

  const startMovePin = (d: PanchayatDetail) => {
    const map = mapRef.current;
    const c = map?.getCenter();
    setPinEdit({ id: d.id, name: d.name, lat: d.lat ?? c?.lat ?? SEEMANCHAL_CENTER[1], lng: d.lng ?? c?.lng ?? SEEMANCHAL_CENTER[0] });
  };
  const savePin = async () => {
    if (!pinEdit) return;
    setSavingPin(true);
    try {
      await geo.setPin(pinEdit.id, pinEdit.lat, pinEdit.lng);
      showToast(`Pin saved for ${pinEdit.name}. Agents now navigate to this spot.`);
      setPinEdit(null);
      setPanelVersion((v) => v + 1);
      void coverage.reload();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setSavingPin(false);
    }
  };

  const selectedAgent = selected?.type === 'agent' ? agents.find((a) => a.agentId === selected.id) : undefined;

  return (
    <div className="geo-page">
      <div className="geo-map-wrap">
        <div ref={containerRef} className="geo-map" role="region" aria-label="Map of panchayats and field agents" />
        {mapError && (
          <div className="geo-map-error">
            The map background couldn&apos;t load. Check the internet connection — the lists on the right still work.
          </div>
        )}

        <div className="geo-toolbar">
          <select className="crm-select" aria-label="District" value={district} onChange={(e) => { setDistrict(e.target.value); setBlock(''); }}>
            <option value="">All districts</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="crm-select" aria-label="Block" value={block} onChange={(e) => setBlock(e.target.value)}>
            <option value="">All blocks</option>
            {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="crm-select" aria-label="Agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All agents</option>
            {(live.data?.agents ?? []).map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
          </select>
          <div className="geo-seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>

        {pinEdit && (
          <div className="geo-pinbar" role="status">
            <span>Drag the blue pin onto <strong>{pinEdit.name}</strong>&apos;s main village.</span>
            <button type="button" className="crm-btn is-sm" onClick={savePin} disabled={savingPin}>{savingPin ? 'Saving…' : 'Save pin'}</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPinEdit(null)}>Cancel</button>
          </div>
        )}

        <div className="geo-legend" aria-label="Legend">
          {STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={shown[s]} onClick={() => setShown((v) => ({ ...v, [s]: !v[s] }))} title={STATUS_META[s].hint}>
              <span className="geo-swatch" style={{ ['--c' as string]: STATUS_META[s].color }} />
              {STATUS_META[s].label} <span className="crm-cell-sub">· {counts[s]}</span>
            </button>
          ))}
          <button type="button" aria-pressed={showAgents} onClick={() => setShowAgents((v) => !v)}>
            <span className="geo-swatch" style={{ ['--c' as string]: AGENT_STATUS_META.moving.color, borderRadius: 999 }} />
            Field agents
          </button>
        </div>

        <div className="geo-live-badge">
          <span className={`crm-live${liveStatus === 'live' ? '' : ' is-polling'}`}>
            <span className="crm-live-dot" aria-hidden="true" />
            {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting…' : 'Auto-refresh'}
          </span>
        </div>
      </div>

      <aside className="geo-side" aria-label="Details">
        {selected?.type === 'panchayat' ? (
          <PanchayatPanel
            id={selected.id} from={from} to={to}
            canEditField={canEditField} canEditPartners={canEditPartners}
            onClose={() => setSelected(null)} onMovePin={startMovePin} onToast={showToast} version={panelVersion}
          />
        ) : selectedAgent ? (
          <AgentCard a={selectedAgent} now={now} onClose={() => setSelected(null)} />
        ) : (
          <Overview
            rows={visibleRows} counts={counts} agents={agents} now={now}
            loading={!coverage.data} error={coverage.error} onRetry={coverage.reload}
            liveError={live.error}
            onAgent={(id) => setSelected({ type: 'agent', id })}
            onBlock={(b) => setBlock(b)}
            block={block}
          />
        )}
      </aside>
      {toast}
    </div>
  );
}

function Overview({ rows, counts, agents, now, loading, error, onRetry, liveError, onAgent, onBlock, block }: {
  rows: CoverageRow[]; counts: Record<CoverageStatus, number>; agents: LiveAgent[]; now: number;
  loading: boolean; error: string | null; onRetry: () => void; liveError: string | null;
  onAgent: (id: string) => void; onBlock: (b: string) => void; block: string;
}) {
  const total = rows.length;
  const covered = total - counts.untouched;
  const byBlock = useMemo(() => {
    const m = new Map<string, Record<CoverageStatus, number> & { total: number }>();
    for (const r of rows) {
      const k = r.block;
      const v = m.get(k) ?? { patients: 0, partners: 0, visited: 0, untouched: 0, total: 0 };
      v[r.status]++; v.total++;
      m.set(k, v);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v, pct: v.total ? Math.round(((v.total - v.untouched) / v.total) * 100) : 0 }))
      .sort((a, b) => a.pct - b.pct);
  }, [rows]);
  const onShift = agents.filter((a) => a.status !== 'off_shift');

  return (
    <>
      <div>
        <h2 className="crm-h2">Coverage</h2>
        <span className="crm-sub" style={{ fontSize: 13 }}>Click a panchayat on the map for its people, visits and survey snapshot.</span>
      </div>
      {error && <ErrorBox message={error} onRetry={onRetry} />}
      {loading ? <Skeleton h={90} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="geo-metric-value" style={{ fontSize: 28 }}>{total ? Math.round((covered / total) * 100) : 0}%</span>
            <span className="crm-sub" style={{ fontSize: 13 }}>{covered} of {total} panchayats visited or with partners</span>
          </div>
          <div className="geo-stack" aria-hidden="true">
            {STATUSES.map((s) => <span key={s} style={{ width: `${total ? (counts[s] / total) * 100 : 0}%`, ['--c' as string]: STATUS_META[s].color }} />)}
          </div>
          <div className="crm-chips" style={{ fontSize: 12 }}>
            {STATUSES.map((s) => (
              <span key={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="geo-swatch" style={{ ['--c' as string]: STATUS_META[s].color }} />{counts[s]} {STATUS_META[s].label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="crm-card-head" style={{ marginBottom: 6 }}>
          <h3 className="crm-h2" style={{ fontSize: 16 }}>Field force now</h3>
          <span className="crm-sub" style={{ fontSize: 12 }}>{onShift.length} of {agents.length} on shift</span>
        </div>
        {liveError && <ErrorBox message={liveError} />}
        {agents.length === 0 ? <Empty title="No field agents yet">Onboard agents in Users &amp; roles.</Empty> : (
          <ul className="crm-list">
            {agents.map((a) => (
              <li key={a.agentId}>
                <button type="button" className="geo-agent-row" onClick={() => onAgent(a.agentId)}>
                  <span className="geo-dot" style={{ ['--c' as string]: AGENT_STATUS_META[a.status].color }} aria-hidden="true" />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <span className="crm-cell-sub">
                      {a.status === 'on_visit' && a.currentPlace ? `At ${a.currentPlace}` : AGENT_STATUS_META[a.status].label}
                      {a.at && a.status !== 'off_shift' ? ` · ${timeAgo(a.at, now)}` : ''}
                    </span>
                  </span>
                  <span className="crm-cell-sub" style={{ textAlign: 'right' }}>{a.today.visits} visits<br />{a.today.km.toFixed(1)} km</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {byBlock.length > 1 && (
        <div>
          <div className="crm-card-head" style={{ marginBottom: 6 }}>
            <h3 className="crm-h2" style={{ fontSize: 16 }}>Blocks, least covered first</h3>
          </div>
          {byBlock.slice(0, 12).map((b) => (
            <button key={b.name} type="button" className="geo-block-row" aria-pressed={block === b.name} onClick={() => onBlock(block === b.name ? '' : b.name)}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
              <span className="geo-stack">
                {STATUSES.map((s) => <span key={s} style={{ width: `${(b[s] / b.total) * 100}%`, ['--c' as string]: STATUS_META[s].color }} />)}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{b.pct}%</span>
            </button>
          ))}
          <Link href="/admin/coverage" className="crm-sub" style={{ fontSize: 13, display: 'inline-block', marginTop: 8 }}>All panchayats and blocks →</Link>
        </div>
      )}
    </>
  );
}

function AgentCard({ a, now, onClose }: { a: LiveAgent; now: number; onClose: () => void }) {
  return (
    <section className="geo-panel" aria-label={`Agent ${a.name}`}>
      <header className="geo-panel-head">
        <span className="crm-avatar" style={{ background: AGENT_STATUS_META[a.status].color, width: 44, height: 44 }}>{initials(a.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="crm-h2" style={{ fontSize: 20 }}>{a.name}</h2>
          <span className="crm-sub" style={{ fontSize: 12 }}>{[a.block, a.district].filter(Boolean).join(' · ') || a.agentId}</span>
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onClose} aria-label="Close agent" style={{ width: 36, padding: 0 }}><X size={16} aria-hidden /></button>
      </header>
      <div className="geo-status-row">
        <span className="geo-status" style={{ ['--c' as string]: AGENT_STATUS_META[a.status].color }}>
          <span className="geo-swatch" style={{ borderRadius: 999 }} aria-hidden="true" />
          {a.status === 'on_visit' && a.currentPlace ? `In ${a.currentPlace}` : AGENT_STATUS_META[a.status].label}
        </span>
        {a.at && <span className="crm-sub" style={{ fontSize: 12 }}>Last location {timeAgo(a.at, now)}{a.accuracyM ? ` · ±${Math.round(a.accuracyM)} m` : ''}</span>}
      </div>
      {a.status === 'no_signal' && (
        <div className="crm-note" style={{ fontSize: 13 }}>
          On shift but no location for {a.minutesSinceSeen ?? '?'} min — the phone may be off, out of signal, or the app closed.
        </div>
      )}
      {a.shiftStartedAt && <span className="crm-sub" style={{ fontSize: 13 }}>Shift started {fmt.time(a.shiftStartedAt)}{a.currentPlaceSince ? ` · checked in ${fmt.time(a.currentPlaceSince)}` : ''}</span>}
      <div className="geo-metrics">
        <div className="geo-metric"><span className="crm-kpi-label" style={{ fontSize: 12 }}>Visits</span><span className="geo-metric-value">{a.today.visits}</span><span className="crm-cell-sub">{a.today.panchayats} panchayats</span></div>
        <div className="geo-metric"><span className="crm-kpi-label" style={{ fontSize: 12 }}>Partners</span><span className="geo-metric-value">{a.today.partners}</span><span className="crm-cell-sub">added today</span></div>
        <div className="geo-metric"><span className="crm-kpi-label" style={{ fontSize: 12 }}>Referrals</span><span className="geo-metric-value">{a.today.referrals}</span><span className="crm-cell-sub">today</span></div>
        <div className="geo-metric"><span className="crm-kpi-label" style={{ fontSize: 12 }}>Distance</span><span className="geo-metric-value">{a.today.km.toFixed(1)}</span><span className="crm-cell-sub">km today</span></div>
      </div>
      <div className="crm-chips">
        <Link className="crm-btn is-sm" href={`/admin/activity?agent=${encodeURIComponent(a.agentId)}`}><Activity size={14} aria-hidden /> Today&apos;s timeline</Link>
        {a.phone && <a className="crm-btn is-secondary is-sm" href={`tel:${a.phone}`}><Phone size={14} aria-hidden /> Call</a>}
        {a.status === 'off_shift' && <Pill>Not on shift</Pill>}
      </div>
    </section>
  );
}
