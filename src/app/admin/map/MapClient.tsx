'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAgentStore } from '@/store/agent-store';
import { getAgents, getAgentTrajectory, type AdminAgentDto, type TrajectoryPointDto } from '@/lib/sync/api-client';
import { getBasemapStyle } from '@/lib/geo/mapStyle';

interface PanchayatGeo {
  name: string;
  block: string;
  district: string;
  centroidLat: number;
  centroidLng: number;
  villages?: string[];
  total_villages?: number;
}

// Popup.setHTML() renders raw HTML with no escaping of its own — agent.name in
// particular comes from the onboarding form with no character restriction, so
// an unescaped interpolation here is a stored-XSS vector (any admin viewing the
// map runs whatever a crafted name contains).
function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function MapClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const searchParams = useSearchParams();
  const deepLinkAgentId = searchParams.get('agentId');
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasLoadedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const replayMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [agents, setAgents] = useState<AdminAgentDto[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [trajectory, setTrajectory] = useState<TrajectoryPointDto[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [replayIdx, setReplayIdx] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(1000); // ms per point

  // Territory Mapping States
  const [panchayats, setPanchayats] = useState<PanchayatGeo[]>([]);
  const [selectedPanchayatDistrict, setSelectedPanchayatDistrict] = useState<string>('');
  const [selectedPanchayatBlock, setSelectedPanchayatBlock] = useState<string>('');
  const [selectedPanchayat, setSelectedPanchayat] = useState<string>('');
  const panchayatMarkersRef = useRef<maplibregl.Marker[]>([]);

  const selectedAgent = agents.find((a) => a.agentId === selectedAgentId);

  // Fetch agents (list + poll — same cadence as the Agents page)
  const loadAgents = useCallback(async () => {
    if (!agentId) return;
    try {
      const data = await getAgents();
      setAgents(data);
      setAgentsError(null);
      setSelectedAgentId((current) => current || deepLinkAgentId || data[0]?.agentId || '');
    } catch (err) {
      // Was previously a console.error-only failure — the map kept showing
      // stale agent positions with no indication anything was wrong, which
      // read as "I can't see where the agent is" once a session expired.
      console.error('Failed to load agents', err);
      setAgentsError(err instanceof Error ? err.message : 'Failed to load agents.');
    }
  }, [agentId, deepLinkAgentId]);

  useEffect(() => {
    void loadAgents();
    const timer = setInterval(() => void loadAgents(), 30_000);
    return () => clearInterval(timer);
  }, [loadAgents]);

  // Fetch trajectory whenever the selected agent changes
  useEffect(() => {
    if (!agentId || !selectedAgentId) {
      setTrajectory([]);
      return;
    }
    setReplayIdx(0);
    setIsPlaying(false);
    getAgentTrajectory(selectedAgentId)
      .then(setTrajectory)
      .catch((err) => {
        console.error('Failed to load trajectory', err);
        setTrajectory([]);
      });
  }, [agentId, selectedAgentId]);

  // Fetch Panchayats (real LGD reference data bundled with the frontend)
  useEffect(() => {
    fetch('/data/panchayats.json')
      .then((res) => res.json())
      .then((data) => setPanchayats(data))
      .catch((err) => console.error(err));
  }, []);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBasemapStyle(),
      center: [87.5701, 25.5541], // Seemanchal center
      zoom: 9.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    mapRef.current = map;

    // A style/tile-source failure that happens before the map ever loads
    // otherwise leaves a blank map with no indication anything went wrong —
    // but MapLibre also fires 'error' for individual tile hiccups during
    // ordinary panning/zooming (a single dropped request on a flaky
    // connection, common for field agents), which is normal and shouldn't
    // hide an otherwise-working map. Only surface the fatal message if the
    // map never successfully loaded in the first place.
    map.on('error', (e) => {
      console.error('Map error', e.error);
      if (!hasLoadedRef.current) setMapError(true);
    });

    map.on('load', () => {
      hasLoadedRef.current = true;
      // Add Seemanchal block boundaries GeoJSON source & layer
      map.addSource('seemanchal-blocks', {
        type: 'geojson',
        data: '/data/seemanchal_blocks.geojson',
      });

      map.addLayer({
        id: 'blocks-fill',
        type: 'fill',
        source: 'seemanchal-blocks',
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'total_villages'], 0],
            0, '#f8fafc',
            1, '#c7d2fe',
            50, '#818cf8',
            100, '#4f46e5',
            150, '#312e81',
          ],
          'fill-opacity': 0.6,
        },
      });

      // Add a popup on click for blocks
      map.on('click', 'blocks-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 6px; font-family: inherit;">
              <strong style="color: #0f172a; font-size: 1rem;">${escapeHtml(props.block)} Block</strong><br/>
              <span style="color: #475569; font-size: 0.85rem;">District: ${escapeHtml(props.district)}</span><br/><br/>
              <div style="display: flex; gap: 12px; margin-top: 4px;">
                <div>
                  <div style="font-size: 1.1rem; font-weight: 700; color: #4f46e5;">${props.total_panchayats || 0}</div>
                  <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Panchayats</div>
                </div>
                <div>
                  <div style="font-size: 1.1rem; font-weight: 700; color: #4f46e5;">${props.total_villages || 0}</div>
                  <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Villages</div>
                </div>
              </div>
            </div>
          `)
          .addTo(mapRef.current!);
      });

      map.on('mouseenter', 'blocks-fill', () => {
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'blocks-fill', () => {
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
      });

      map.addLayer({
        id: 'blocks-line',
        type: 'line',
        source: 'seemanchal-blocks',
        paint: {
          'line-color': '#6366f1',
          'line-width': 1.5,
          'line-dasharray': [2, 2],
        },
      });

      // Add trajectory line source
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [],
          },
        },
      });

      // Glowing outer line
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#6366f1',
          'line-width': 8,
          'line-opacity': 0.3,
        },
      });

      // Core trajectory line
      map.addLayer({
        id: 'route-core',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#818cf8',
          'line-width': 3,
        },
      });

      setMapLoaded(true);
      setTimeout(() => map.resize(), 100);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      hasLoadedRef.current = false;
    };
  }, []);

  // Redraw agent pins whenever the agent list or selection changes (every 30s
  // poll included). Kept separate from the trajectory/flyTo effect below so a
  // routine agent-list poll never yanks the map back to the trajectory start.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add agent pins — only for agents with at least one recorded GPS fix
    agents.forEach((agent) => {
      if (agent.lastSeenLat == null || agent.lastSeenLng == null) return;

      const isSelected = agent.agentId === selectedAgentId;
      const el = document.createElement('div');
      el.className = 'custom-map-marker';
      el.style.width = isSelected ? '40px' : '32px';
      el.style.height = isSelected ? '40px' : '32px';
      el.style.borderRadius = '50%';
      el.style.background = isSelected
        ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
        : agent.status === 'online'
        ? 'linear-gradient(135deg, #10b981, #059669)'
        : '#475569';
      el.style.border = isSelected ? '3px solid #fff' : '2px solid rgba(255,255,255,0.7)';
      el.style.boxShadow = isSelected ? '0 0 16px rgba(99,102,241,0.6)' : '0 2px 6px rgba(0,0,0,0.4)';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.color = '#fff';
      el.style.fontWeight = '700';
      el.style.fontSize = isSelected ? '0.9rem' : '0.75rem';
      el.style.cursor = 'pointer';
      el.style.transition = 'all 0.2s';
      el.innerText = agent.name.slice(0, 2).toUpperCase();

      el.addEventListener('click', () => {
        setSelectedAgentId(agent.agentId);
        setIsPlaying(false);
        setReplayIdx(0);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([agent.lastSeenLng, agent.lastSeenLat])
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(`
            <div style="color: #0f172a; padding: 4px;">
              <strong>${escapeHtml(agent.name)}</strong> (${escapeHtml(agent.block)})<br/>
              Status: <span style="color: ${agent.status === 'online' ? '#10b981' : '#64748b'}">${escapeHtml(agent.status.toUpperCase())}</span><br/>
              Visits today: ${escapeHtml(agent.todayVisits)}
            </div>
          `)
        )
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [selectedAgentId, agents, mapLoaded]);

  // Update the trajectory line and fly to it — deliberately keyed only on
  // `trajectory` (which only changes when a different agent is selected or
  // the trajectory is refetched), NOT on `agents`, so the routine 30s agent
  // poll never yanks the map back to the trajectory start mid-pan/zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (replayMarkerRef.current) {
      replayMarkerRef.current.remove();
      replayMarkerRef.current = null;
    }

    if (map.isStyleLoaded() && map.getSource('route')) {
      const coords = trajectory.map((p) => [p.lng, p.lat]);
      const source = map.getSource('route') as maplibregl.GeoJSONSource;
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      });

      // Fly to agent trajectory center
      if (coords.length > 0) {
        map.flyTo({
          center: coords[0] as [number, number],
          zoom: 12,
          speed: 1.2,
        });
      }
    }
  }, [trajectory, mapLoaded]);

  // Replay animation loop
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isPlaying && trajectory.length > 0) {
      timer = setInterval(() => {
        setReplayIdx((prev) => {
          if (prev >= trajectory.length - 1) {
            setIsPlaying(false);
            return trajectory.length - 1;
          }
          return prev + 1;
        });
      }, speed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, trajectory.length, speed]);

  // Sync replay marker position with replayIdx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || trajectory.length === 0 || replayIdx >= trajectory.length) return;

    const pt = trajectory[replayIdx];
    if (!pt) return;

    if (!replayMarkerRef.current) {
      const el = document.createElement('div');
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '50%';
      el.style.background = '#38bdf8';
      el.style.border = '3px solid #fff';
      el.style.boxShadow = '0 0 12px #38bdf8';
      replayMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([pt.lng, pt.lat]).addTo(map);
    }

    replayMarkerRef.current.setLngLat([pt.lng, pt.lat]);
    map.panTo([pt.lng, pt.lat], { duration: speed * 0.8 });
  }, [replayIdx, trajectory, speed]);

  const currentPoint = trajectory[replayIdx] || null;

  // Panchayat Marker Rendering
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // Clear old markers
    panchayatMarkersRef.current.forEach((m) => m.remove());
    panchayatMarkersRef.current = [];

    // Filter
    let filtered = panchayats;
    if (selectedPanchayatDistrict) filtered = filtered.filter((p) => p.district === selectedPanchayatDistrict);
    if (selectedPanchayatBlock) filtered = filtered.filter((p) => p.block === selectedPanchayatBlock);
    if (selectedPanchayat) filtered = filtered.filter((p) => p.name === selectedPanchayat);

    if (filtered.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    filtered.forEach((p) => {
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.background = '#f59e0b';
      el.style.border = '2px solid #fff';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
      el.style.cursor = 'pointer';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.centroidLng, p.centroidLat])
        .setPopup(
          new maplibregl.Popup({ offset: 15, closeButton: false }).setHTML(
            `<div style="padding:6px;font-family:inherit;max-width:200px;max-height:250px;overflow-y:auto;">
              <strong style="color:var(--text-primary);font-size:0.9rem">${escapeHtml(p.name)}</strong><br/>
              <span style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(p.block)}, ${escapeHtml(p.district)}</span>
              ${p.total_villages ? `<br/><br/><strong style="font-size:0.75rem;color:#4f46e5;">VILLAGES (${p.total_villages}):</strong><br/><div style="font-size:0.75rem;color:#475569;margin-top:2px;">${escapeHtml(p.villages?.join(', ') || '')}</div>` : ''}
            </div>`
          )
        )
        .addTo(mapRef.current!);

      panchayatMarkersRef.current.push(marker);
      bounds.extend([p.centroidLng, p.centroidLat]);
    });

    // Fit map bounds if filters are applied
    if ((selectedPanchayatDistrict || selectedPanchayatBlock || selectedPanchayat) && filtered.length > 0) {
      if (filtered.length === 1) {
        mapRef.current.flyTo({ center: [filtered[0].centroidLng, filtered[0].centroidLat], zoom: 12 });
      } else {
        mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 12 });
      }
    }
  }, [panchayats, selectedPanchayatDistrict, selectedPanchayatBlock, selectedPanchayat, mapLoaded]);

  // Derived unique lists for dropdowns
  const uniqueDistricts = Array.from(new Set(panchayats.map((p) => p.district))).sort();
  const availableBlocks = Array.from(new Set(panchayats.filter((p) => !selectedPanchayatDistrict || p.district === selectedPanchayatDistrict).map((p) => p.block))).sort();
  const availablePanchayats = Array.from(new Set(panchayats.filter((p) => (!selectedPanchayatDistrict || p.district === selectedPanchayatDistrict) && (!selectedPanchayatBlock || p.block === selectedPanchayatBlock)).map((p) => p.name))).sort();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Left Sidebar — Control Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto', paddingRight: '0.5rem' }}>
        {agentsError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}>
            ⚠️ {agentsError} — agent positions may be stale.
          </div>
        )}
        {/* Territory Explorer */}
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            🗺️ Territory Explorer
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Filter and plot specific panchayats on the map.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label">District</label>
              <select
                className="field-input"
                value={selectedPanchayatDistrict}
                onChange={(e) => { setSelectedPanchayatDistrict(e.target.value); setSelectedPanchayatBlock(''); setSelectedPanchayat(''); }}
              >
                <option value="">All Districts</option>
                {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label">Block / Council</label>
              <select
                className="field-input"
                value={selectedPanchayatBlock}
                onChange={(e) => { setSelectedPanchayatBlock(e.target.value); setSelectedPanchayat(''); }}
              >
                <option value="">All Blocks</option>
                {availableBlocks.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label">Panchayat / Village</label>
              <select
                className="field-input"
                value={selectedPanchayat}
                onChange={(e) => setSelectedPanchayat(e.target.value)}
                disabled={!selectedPanchayatBlock}
              >
                <option value="">All Panchayats</option>
                {availablePanchayats.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {(selectedPanchayatDistrict || selectedPanchayatBlock || selectedPanchayat) && (
              <button
                className="btn btn-ghost"
                style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                onClick={() => { setSelectedPanchayatDistrict(''); setSelectedPanchayatBlock(''); setSelectedPanchayat(''); mapRef.current?.flyTo({ center: [87.5701, 25.5541], zoom: 9.5 }); }}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            📍 Active Field Outreach
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Select an agent to inspect their last known location and replay today&apos;s recorded shift trajectory.
          </p>

          {agents.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No agents yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {agents.map((a) => {
                const isSel = a.agentId === selectedAgentId;
                return (
                  <div
                    key={a.agentId}
                    onClick={() => {
                      setSelectedAgentId(a.agentId);
                      setIsPlaying(false);
                      setReplayIdx(0);
                    }}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: isSel ? 'rgba(99,102,241,0.15)' : 'var(--surface-bg)',
                      border: `1px solid ${isSel ? 'var(--color-primary-500)' : 'var(--surface-border)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: isSel ? 'var(--color-primary-600)' : 'var(--text-primary)', fontSize: '0.9rem' }}>
                        {a.name}
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: a.status === 'online' ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)',
                          color: a.status === 'online' ? '#10b981' : '#94a3b8',
                          fontSize: '0.7rem',
                        }}
                      >
                        {a.status === 'online' ? '🟢 ONLINE' : a.status === 'low-connectivity' ? '🟡 LOW SIG' : '⚪ OFFLINE'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      Block: <strong>{a.block}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Trajectory Replay Control Box */}
        {selectedAgent && (
          <div className="card" style={{ borderTop: '3px solid var(--color-primary-500)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>
                🔄 Trajectory Replay (today)
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-400)', fontWeight: 600 }}>
                {trajectory.length} waypoints
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Replaying today&apos;s route for <strong>{selectedAgent.name}</strong> ({selectedAgent.district}).
            </p>

            {/* Progress Slider */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                <span>Point {replayIdx + 1} of {trajectory.length || 1}</span>
                <span>
                  {currentPoint
                    ? new Date(currentPoint.recordedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '--:--'}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, trajectory.length - 1)}
                value={replayIdx}
                onChange={(e) => {
                  setIsPlaying(false);
                  setReplayIdx(Number(e.target.value));
                }}
                style={{ width: '100%', accentColor: 'var(--color-primary-500)', cursor: 'pointer' }}
                disabled={trajectory.length === 0}
              />
            </div>

            {/* Playback Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                className={`btn ${isPlaying ? 'btn-danger' : 'btn-primary'}`}
                style={{ flex: 1, padding: '0.5rem' }}
                onClick={() => {
                  if (replayIdx >= trajectory.length - 1) setReplayIdx(0);
                  setIsPlaying(!isPlaying);
                }}
                disabled={trajectory.length === 0}
              >
                {isPlaying ? '⏸ Pause Replay' : '▶ Start Replay'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setIsPlaying(false);
                  setReplayIdx(0);
                }}
                title="Reset to start"
              >
                ⏹ Reset
              </button>
            </div>

            {/* Speed Selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <span>Replay Speed:</span>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {[
                  { label: '1x', val: 1200 },
                  { label: '2x', val: 600 },
                  { label: '5x', val: 200 },
                ].map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setSpeed(s.val)}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid var(--surface-border)',
                      background: speed === s.val ? 'var(--color-primary-600)' : 'transparent',
                      color: speed === s.val ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Point Metrics */}
            {currentPoint && (
              <div style={{ marginTop: '1rem', padding: '0.6rem', background: 'var(--surface-input)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--surface-border)' }}>
                <div>📍 Lat/Lng: <strong>{currentPoint.lat.toFixed(5)}, {currentPoint.lng.toFixed(5)}</strong></div>
                <div>📡 Accuracy: ±{currentPoint.accuracyM ?? 10}m</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Map Canvas Area */}
      <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)', boxShadow: 'var(--shadow-lg)', minHeight: '500px' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {mapError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.85)', color: '#fff', zIndex: 20, textAlign: 'center', padding: '2rem' }}>
            <div>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️⚠️</div>
              <p style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Map failed to load</p>
              <p style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>The basemap tile provider couldn&apos;t be reached. Agent list and data below are unaffected.</p>
            </div>
          </div>
        )}

        {/* Map Overlay Badge */}
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--surface-border)', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Seemanchal & Outreach Territories</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-primary-600)' }}>Showing Katihar · Purnia · Araria · Supaul · Uttar Dinajpur</div>
        </div>
      </div>
    </div>
  );
}
