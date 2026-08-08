'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveShift, useActiveVisit, useVisits, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { getMyAssignment, type MyAssignmentDto } from '@/lib/sync/api-client';
import AddMissingPanchayatButton from '@/components/AddMissingPanchayatButton';
import type { LocalVisit } from '@/lib/db/schema';
import { useTranslations } from '@/i18n/I18nProvider';

export default function VisitPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const setActiveVisit = useAgentStore((s) => s.setActiveVisit);

  const panchayats = usePanchayats();
  const localVisits = useVisits(agentId ?? undefined);
  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);
  const t = useTranslations();

  const [selectedPanchayat, setSelectedPanchayat] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [assignment, setAssignment] = useState<MyAssignmentDto | null>(null);

  // Live fetch, best-effort — if it fails (offline, no assignment yet) we fall
  // back to the full unscoped panchayat list below so check-in is never blocked.
  useEffect(() => {
    if (!agentId) return;
    getMyAssignment().then(setAssignment).catch(() => setAssignment(null));
  }, [agentId]);

  const { position, permission } = useGeolocation({
    shiftId: activeShift?.clientId,
    visitId: activeVisit?.clientId,
    record: !!activeShift,
  });

  const isOnShift = !!activeShift && !activeShift.endAt;
  const hasActiveVisit = !!activeVisit;

  // Locally-recorded visits count as "visited" immediately, even before the
  // server-computed assignment checklist has synced.
  const locallyVisitedIds = useMemo(
    () => new Set((localVisits ?? []).map((v) => v.panchayatId)),
    [localVisits]
  );

  const assignedPanchayats = useMemo(() => {
    if (!assignment?.block) return null;
    return assignment.panchayats
      .map((p) => ({ id: p.panchayatId, name: p.name, visited: p.visited || locallyVisitedIds.has(p.panchayatId) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignment, locallyVisitedIds]);

  const groupedPanchayats = useMemo(() => {
    if (!panchayats) return {};
    return panchayats.reduce<Record<string, typeof panchayats>>((acc, p) => {
      (acc[p.district] ??= []).push(p);
      return acc;
    }, {});
  }, [panchayats]);

  async function handleCheckIn() {
    if (!position) { setError(t.errWaitGps); return; }
    if (!selectedPanchayat) { setError(t.errSelectPanchayat); return; }
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
      setError(t.errCheckIn);
    } finally {
      setLoading(false);
    }
  }

  if (!isOnShift) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="empty-state-icon">⏰</div>
        <h2>{t.noActiveShift}</h2>
        <p style={{ fontSize: '0.85rem' }}>{t.startShiftDesc}</p>
        <button className="btn btn-primary" onClick={() => router.push('/home')} style={{ marginTop: '0.5rem' }}>
          {t.goToHome}
        </button>
      </div>
    );
  }

  if (hasActiveVisit) {
    return (
      <div>
        <div className="page-header">
          <h1>{t.currentVisit}</h1>
        </div>
        <div className="shift-banner" style={{ marginBottom: '1rem', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem' }}>📍</p>
          <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.visitInProgress}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t.checkedInAt} {new Date(activeVisit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            id="goto-visit-btn"
            className="btn btn-primary btn-full btn-lg"
            onClick={() => router.push(`/visit/${activeVisit.clientId}`)}
          >
            {t.viewVisitDetails}
          </button>
          <button
            id="new-contact-in-visit-btn"
            className="btn btn-ghost btn-full"
            onClick={() => router.push('/contacts/new')}
          >
            {t.addContactPanchayat}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t.checkInTitle}</h1>
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
          ? `${t.gpsLocked} ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · ±${Math.round(position.accuracyM)}m`
          : permission === 'denied'
          ? t.gpsDenied
          : t.acquiringGps}
      </div>

      {/* Panchayat selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label className="field-label" style={{ display: 'block', marginBottom: '0.5rem' }}>{t.selectPanchayatTitle}</label>

        {assignedPanchayats ? (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              {t.yourAssignedBlock}: <strong style={{ color: 'var(--text-primary)' }}>{assignment!.block}</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem' }}>
              {assignedPanchayats.map((p) => {
                const isSelected = selectedPanchayat === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPanchayat(p.id)}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: isSelected ? '2px solid var(--color-primary-500)' : '1px solid var(--surface-border)',
                      background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--surface-card, #fff)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: p.visited ? '#10b981' : 'var(--text-muted)' }}>
                      {p.visited ? `✅ ${t.visitedBadge}` : `⏳ ${t.pendingBadge}`}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <AddMissingPanchayatButton
                deviceId={deviceId}
                position={position}
                onAdded={(p) => setSelectedPanchayat(p.id)}
              />
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {t.noBlockAssignedCheckin}
            </p>
            <select
              id="checkin-panchayat"
              className="field-input"
              value={selectedPanchayat}
              onChange={(e) => setSelectedPanchayat(e.target.value)}
            >
              <option value="">{t.choosePanchayat}</option>
              {Object.entries(groupedPanchayats).sort().map(([district, list]) => (
                <optgroup key={district} label={district}>
                  {list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.block})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div style={{ marginTop: '0.5rem' }}>
              <AddMissingPanchayatButton
                deviceId={deviceId}
                position={position}
                onAdded={(p) => setSelectedPanchayat(p.id)}
              />
            </div>
          </>
        )}
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
          ? t.checkingIn
          : !position
          ? t.waitingGpsBtn
          : t.checkInNow}
      </button>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', marginTop: '1rem' }}>
        {t.gpsWarning}
      </p>
    </div>
  );
}
