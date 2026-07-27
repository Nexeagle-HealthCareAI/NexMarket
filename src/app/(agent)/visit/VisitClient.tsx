'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveShift, useActiveVisit, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import type { LocalVisit } from '@/lib/db/schema';

export default function VisitPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeShiftClientId = useAgentStore((s) => s.activeShiftClientId);
  const activeVisitClientId = useAgentStore((s) => s.activeVisitClientId);
  const setActiveVisit = useAgentStore((s) => s.setActiveVisit);

  const panchayats = usePanchayats();
  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);

  const [selectedPanchayat, setSelectedPanchayat] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { position, permission } = useGeolocation({
    shiftId: activeShift?.clientId,
    visitId: activeVisit?.clientId,
    record: !!activeShift,
  });

  const isOnShift = !!activeShift && !activeShift.endAt;
  const hasActiveVisit = !!activeVisit;

  const groupedPanchayats = useMemo(() => {
    if (!panchayats) return {};
    return panchayats.reduce<Record<string, typeof panchayats>>((acc, p) => {
      (acc[p.district] ??= []).push(p);
      return acc;
    }, {});
  }, [panchayats]);

  async function handleCheckIn() {
    if (!position) { setError('Waiting for GPS fix…'); return; }
    if (!selectedPanchayat) { setError('Select a panchayat first'); return; }
    if (!agentId || !deviceId) return;

    setLoading(true);
    setError('');

    const clientId = uuidv4();
    const now = new Date().toISOString();

    const visit: LocalVisit = {
      clientId,
      deviceId,
      agentId,
      panchayatId: selectedPanchayat,
      shiftId: activeShift?.clientId,
      checkInAt: now,
      checkInLat: position.lat,
      checkInLng: position.lng,
    };

    try {
      await db.visits.add(visit);
      await addToOutbox(clientId, deviceId, 'visit', visit);
      setActiveVisit(clientId);
      router.push(`/visit/${clientId}`);
    } catch {
      setError('Failed to check in. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOnShift) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="empty-state-icon">⏰</div>
        <h2>No Active Shift</h2>
        <p style={{ fontSize: '0.85rem' }}>Start your shift from the Home screen before checking in</p>
        <button className="btn btn-primary" onClick={() => router.push('/home')} style={{ marginTop: '0.5rem' }}>
          Go to Home
        </button>
      </div>
    );
  }

  if (hasActiveVisit) {
    return (
      <div>
        <div className="page-header">
          <h1>Current Visit</h1>
        </div>
        <div className="shift-banner" style={{ marginBottom: '1rem', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem' }}>📍</p>
          <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Visit in progress</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Checked in at {new Date(activeVisit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            id="goto-visit-btn"
            className="btn btn-primary btn-full btn-lg"
            onClick={() => router.push(`/visit/${activeVisit.clientId}`)}
          >
            View Visit Details & Check Out
          </button>
          <button
            id="new-contact-in-visit-btn"
            className="btn btn-ghost btn-full"
            onClick={() => router.push('/contacts/new')}
          >
            + Add Contact in This Panchayat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Check In</h1>
      </div>

      {/* GPS status */}
      <div
        className={`gps-banner ${permission === 'granted' && position ? 'locked' : permission === 'denied' ? 'denied' : 'acquiring'}`}
        style={{ marginBottom: '1rem' }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" />
          <circle cx={12} cy={9} r={3} />
        </svg>
        {permission === 'granted' && position
          ? `GPS locked · ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · ±${Math.round(position.accuracyM)}m`
          : permission === 'denied'
          ? 'Location denied — required for check-in'
          : 'Acquiring GPS position…'}
      </div>

      {/* Panchayat selector */}
      <div className="field-group" style={{ marginBottom: '1rem' }}>
        <label className="field-label" htmlFor="checkin-panchayat">Select Panchayat *</label>
        <select
          id="checkin-panchayat"
          className="field-input"
          value={selectedPanchayat}
          onChange={(e) => setSelectedPanchayat(e.target.value)}
        >
          <option value="">Choose panchayat…</option>
          {Object.entries(groupedPanchayats).sort().map(([district, list]) => (
            <optgroup key={district} label={district}>
              {list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.block})</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>
      )}

      <button
        id="checkin-btn"
        className="btn btn-success btn-full btn-lg"
        onClick={handleCheckIn}
        disabled={loading || permission === 'denied' || !position}
      >
        {loading
          ? 'Checking in…'
          : !position
          ? 'Waiting for GPS…'
          : '📍 Check In Now'}
      </button>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', marginTop: '1rem' }}>
        Your GPS location will be recorded at check-in and check-out
      </p>
    </div>
  );
}
