'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MOCK_AGENTS, MOCK_TRAJECTORIES, type AdminAgent } from '@/lib/admin/mock-data';
import type { LocalTrajectoryPoint } from '@/lib/db/schema';

export default function MapClient() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const replayMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string>('agent-101');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [replayIdx, setReplayIdx] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(1000); // ms per point

  const selectedAgent = MOCK_AGENTS.find((a) => a.agentId === selectedAgentId);
  const trajectory: LocalTrajectoryPoint[] = MOCK_TRAJECTORIES[selectedAgentId] || [];

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [87.5701, 25.5541], // Seemanchal center
      zoom: 9.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
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
          'fill-color': '#4f46e5',
          'fill-opacity': 0.08,
        },
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
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers & trajectory line on agent selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (replayMarkerRef.current) {
      replayMarkerRef.current.remove();
      replayMarkerRef.current = null;
    }

    // Add agent pins
    MOCK_AGENTS.forEach((agent) => {
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
              <strong>${agent.name}</strong> (${agent.block})<br/>
              Status: <span style="color: ${agent.status === 'online' ? '#10b981' : '#64748b'}">${agent.status.toUpperCase()}</span><br/>
              Battery: ${agent.batteryPct}% · Visits today: ${agent.todayVisits}
            </div>
          `)
        )
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Update GeoJSON line if style is loaded
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
  }, [selectedAgentId, trajectory]);

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
      replayMarkerRef.current = new maplibregl.Marker({ element: el }).addTo(map);
    }

    replayMarkerRef.current.setLngLat([pt.lng, pt.lat]);
    map.panTo([pt.lng, pt.lat], { duration: speed * 0.8 });
  }, [replayIdx, trajectory, speed]);

  const currentPoint = trajectory[replayIdx] || null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Left Sidebar — Control Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto', paddingRight: '0.5rem' }}>
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            📍 Active Field Outreach
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Select an agent to inspect real-time location and replay their historical shift trajectory across Seemanchal blocks.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {MOCK_AGENTS.map((a) => {
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    <span>Block: <strong>{a.block}</strong></span>
                    <span>🔋 {a.batteryPct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Trajectory Replay Control Box */}
        {selectedAgent && (
          <div className="card" style={{ borderTop: '3px solid var(--color-primary-500)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>
                🔄 Trajectory Replay
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-400)', fontWeight: 600 }}>
                {trajectory.length} waypoints
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Replaying route for <strong>{selectedAgent.name}</strong> ({selectedAgent.district}).
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
      <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)', boxShadow: 'var(--shadow-lg)' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {/* Map Overlay Badge */}
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--surface-border)', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Seemanchal District Boundaries</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-primary-600)' }}>Showing Katihar · Purnia · Araria · Supaul</div>
        </div>
      </div>
    </div>
  );
}
