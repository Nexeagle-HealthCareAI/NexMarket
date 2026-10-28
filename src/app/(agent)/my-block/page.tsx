'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { getMyAssignment, type MyAssignmentDto } from '@/lib/sync/api-client';
import { getSyncStateValue, setSyncStateValue } from '@/lib/db';
import { useQuery } from '@tanstack/react-query';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { formatDistance, haversineDistanceMeters } from '@/lib/geo/distance';
import TaskMap from './TaskMap';

const CACHE_KEY_PREFIX = 'lastAssignment_';
// A gram panchayat spans a few km, and its pin is the middle of its villages — so an agent
// anywhere in the panchayat should be able to check in. Pins known only to the block centre
// don't block check-in at all; the check-in itself teaches the map where the panchayat is.
const CHECK_IN_RADIUS_M = 2500;

function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export default function MyTaskPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const [filter, setFilter] = useState<'all' | 'visited' | 'pending'>('all');
  const [selectedPanchayatId, setSelectedPanchayatId] = useState<string | null>(null);
  
  const { position } = useGeolocation({ record: false });

  const { data: assignment, isLoading, error, isError } = useQuery({
    queryKey: ['my-assignment', agentId],
    queryFn: async () => {
      if (!agentId) throw new Error('No agent ID');
      try {
        const data = await getMyAssignment();
        const cacheKey = CACHE_KEY_PREFIX + agentId;
        await setSyncStateValue(cacheKey, JSON.stringify(data));
        return { data, isStale: false };
      } catch (err) {
        const cacheKey = CACHE_KEY_PREFIX + agentId;
        const cached = await getSyncStateValue(cacheKey);
        if (cached) {
          try {
            return { data: JSON.parse(cached) as MyAssignmentDto, isStale: true };
          } catch {
            // fall through
          }
        }
        throw err;
      }
    },
    enabled: !!agentId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // GPS updates every few seconds; the list re-sorts only when the agent moves ~500 m.
  const posLat = position ? Math.round(position.lat * 200) / 200 : null;
  const posLng = position ? Math.round(position.lng * 200) / 200 : null;

  const { total, visited, pct, visible } = useMemo(() => {
    if (!assignment?.data?.panchayats) {
      return { total: 0, visited: 0, pct: 0, visible: [] };
    }
    const panchs = assignment.data.panchayats;
    const t = panchs.length;
    let v = 0;
    const vis = [];
    for (const p of panchs) {
      if (p.visited) v++;
      if (filter === 'all' || (filter === 'visited') === p.visited) {
        vis.push(p);
      }
    }
    // Nearest first, so the agent can plan the day's route; pending before visited.
    const dist = (p: (typeof panchs)[number]) =>
      posLat != null && posLng != null && p.centroidLat != null && p.centroidLng != null && p.locationSource !== 'block'
        ? haversineDistanceMeters({ lat: posLat, lng: posLng }, { lat: p.centroidLat, lng: p.centroidLng })
        : Number.POSITIVE_INFINITY;
    vis.sort((a, b) => Number(a.visited) - Number(b.visited) || dist(a) - dist(b) || a.name.localeCompare(b.name));
    return {
      total: t,
      visited: v,
      pct: t > 0 ? Math.round((v / t) * 100) : 0,
      visible: vis,
    };
  }, [assignment?.data?.panchayats, filter, posLat, posLng]);

  // Fix Ghost Selection Bug
  useEffect(() => {
    if (selectedPanchayatId && !visible.find((p) => p.panchayatId === selectedPanchayatId)) {
      setSelectedPanchayatId(null);
    }
  }, [visible, selectedPanchayatId]);

  if (isLoading) {
    return <div className="p-12 text-center text-[var(--text-muted)]">Loading your task…</div>;
  }

  if (isError) {
    return <div className="p-12 text-center text-[var(--color-danger)]">{error instanceof Error ? error.message : 'Failed to load your assignment.'}</div>;
  }

  if (!assignment?.data || !assignment.data.block) {
    return (
      <div className="p-12 text-center">
        <div className="text-3xl mb-3">📋</div>
        <h2 className="text-lg text-[var(--text-primary)] mb-2 font-semibold">No active task assigned</h2>
        <p className="text-sm text-[var(--text-muted)]">Your admin hasn&apos;t assigned you a block yet.</p>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl text-[var(--text-primary)] font-bold m-0">My Block</h1>
        <span className="bg-[var(--surface-input)] text-[var(--text-secondary)] px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Daily Checklist</span>
      </div>
      
      {assignment.isStale && (
        <div className="bg-amber-100/50 border border-amber-300/50 rounded-md px-3 py-2 mb-3 text-xs text-amber-700 font-semibold">
          ⚠️ Offline — showing your last downloaded assignment, may not reflect recent changes.
        </div>
      )}
      
      <p className="text-sm text-[var(--text-muted)] mb-5">
        Assigned {assignment.data.assignedAt ? new Date(assignment.data.assignedAt).toLocaleDateString('en-GB') : ''}
      </p>

      {total > 0 && (
        <div className="card mb-5 border-t-4 border-[var(--color-primary-500)]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs font-bold text-[var(--color-primary-600)] uppercase tracking-wider">Mission Briefing</div>
              <div className="text-xl font-extrabold text-[var(--text-primary)] mt-1">{assignment.data.block}</div>
              <div className="text-sm text-[var(--text-muted)]">{assignment.data.district}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[var(--color-primary-600)]">{pct}%</div>
              <div className="text-xs text-[var(--text-muted)]">{visited} / {total} visited</div>
            </div>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-input)] overflow-hidden">
            <div className="h-full bg-[var(--color-primary-500)] transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {assignment.data.notes && (
            <p className="mt-3 text-sm text-[var(--text-secondary)] bg-[var(--surface-input)] p-3 rounded-md">
              📝 {assignment.data.notes}
            </p>
          )}
        </div>
      )}

      <TaskMap
        panchayats={assignment.data.panchayats}
        selectedPanchayatId={selectedPanchayatId}
        onSelectPanchayat={setSelectedPanchayatId}
        position={position}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'pending', 'visited'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm capitalize ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {visible.length === 0 ? (
          <div className="card text-center p-8 text-[var(--text-muted)]">
            Nothing to show for this filter.
          </div>
        ) : (
          visible.map((p) => {
            const isSelected = p.panchayatId === selectedPanchayatId;
            const canRoute = p.centroidLat != null && p.centroidLng != null;
            
            // Geofence checking
            let distanceToTarget = null;
            if (position && canRoute) {
              distanceToTarget = haversineDistanceMeters(position, { lat: p.centroidLat!, lng: p.centroidLng! });
            }
            const approximate = p.locationSource === 'block';
            const isWithinGeofence = approximate || (distanceToTarget !== null && distanceToTarget <= CHECK_IN_RADIUS_M);
            
            return (
              <div
                key={p.panchayatId}
                className={`card p-3 sm:p-4 ${canRoute ? 'cursor-pointer' : 'cursor-default'} ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/25' : ''}`}
                onClick={() => canRoute && setSelectedPanchayatId(isSelected ? null : p.panchayatId)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)] text-sm sm:text-base">{p.name}</div>
                    {p.lastVisitedAt && (
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">
                        Last visited {new Date(p.lastVisitedAt).toLocaleDateString('en-GB')}
                      </div>
                    )}
                    {canRoute && (
                      <div className="text-xs text-blue-500 font-semibold mt-1">
                        {approximate
                          ? '📍 Location approximate'
                          : distanceToTarget !== null
                            ? `🧭 ${formatDistance(distanceToTarget)} away · ${isSelected ? 'route shown above' : 'tap to route'}`
                            : isSelected ? '🧭 Routing shown above' : '🧭 Tap to route'}
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full ${p.visited ? 'bg-emerald-100/50 text-emerald-600' : 'bg-slate-200/50 text-slate-500'}`}
                  >
                    {p.visited ? '✅ Visited' : '⏳ Pending'}
                  </span>
                </div>
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-[var(--surface-border)]">
                    {!isWithinGeofence && !p.visited ? (
                       <div className="text-center text-xs text-red-500 mb-2 font-semibold">
                         Reach {p.name} to check in (within {CHECK_IN_RADIUS_M / 1000} km of its centre).
                         {distanceToTarget !== null && ` You are ${formatDistance(distanceToTarget)} away.`}
                       </div>
                    ) : null}
                    {approximate && !p.visited ? (
                       <div className="text-center text-xs text-amber-600 mb-2 font-semibold">
                         We only know this panchayat&apos;s block. Check in when you reach it — your check-in puts it on the map.
                       </div>
                    ) : null}
                    {!approximate && p.centroidLat != null && p.centroidLng != null && (
                      <a
                        href={directionsUrl(p.centroidLat, p.centroidLng)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost w-full flex justify-center mb-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🗺️ Directions in Google Maps
                      </a>
                    )}
                    <Link 
                      href={isWithinGeofence || p.visited ? `/visit?preselect=${p.panchayatId}` : '#'}
                      className={`btn btn-sm w-full flex justify-center ${isWithinGeofence || p.visited ? 'btn-primary' : 'btn-disabled opacity-50 cursor-not-allowed'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isWithinGeofence && !p.visited) e.preventDefault();
                      }}
                    >
                      📍 Check In Here
                    </Link>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
