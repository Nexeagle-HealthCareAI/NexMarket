'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveShift, useActiveVisit, useVisits, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { getMyAssignment, type MyAssignmentDto } from '@/lib/sync/api-client';
import AddMissingPanchayatButton from '@/components/AddMissingPanchayatButton';
import type { LocalVisit, LocalShift } from '@/lib/db/schema';
import { useTranslations } from '@/i18n/I18nProvider';

export default function VisitPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselect = searchParams.get('preselect');
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const setActiveVisit = useAgentStore((s) => s.setActiveVisit);
  const setActiveShift = useAgentStore((s) => s.setActiveShift);

  const panchayats = usePanchayats();
  const localVisits = useVisits(agentId ?? undefined);
  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);
  const t = useTranslations();

  const [selectedPanchayat, setSelectedPanchayat] = useState(preselect || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [assignment, setAssignment] = useState<MyAssignmentDto | null>(null);

  const [panchayatSearch, setPanchayatSearch] = useState('');
  const [showPanchayatList, setShowPanchayatList] = useState(false);

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

  // Locally-recorded visits count as 'visited' immediately, even before the
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

  // Flat sorted panchayat list for search
  const allPanchayats = useMemo(() => {
    if (!panchayats) return [];
    return [...panchayats].sort((a, b) => a.name.localeCompare(b.name));
  }, [panchayats]);

  const filteredPanchayats = useMemo(() => {
    const q = panchayatSearch.trim().toLowerCase();
    if (!q) return allPanchayats.slice(0, 20);
    return allPanchayats.filter(p =>
      p.name.toLowerCase().includes(q) || p.block.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [allPanchayats, panchayatSearch]);

  const selectedPanchayatName = useMemo(() => {
    return allPanchayats.find(p => p.id === selectedPanchayat)?.name ?? '';
  }, [allPanchayats, selectedPanchayat]);

  async function handleCheckIn() {
    if (!position) { setError(t.errWaitGps); return; }
    if (!selectedPanchayat) { setError(t.errSelectPanchayat); return; }
    if (!agentId || !deviceId) return;

    setLoading(true);
    setError('');
    const now = new Date().toISOString();

    let shiftId = activeShift?.clientId;

    try {
      if (!isOnShift) {
        // Auto-start shift if they aren't on one
        shiftId = uuidv4();
        const shift: LocalShift = { clientId: shiftId, deviceId, agentId, startAt: now };
        await db.shifts.add(shift);
        await addToOutbox(shiftId, deviceId, 'shift', shift);
        setActiveShift(shiftId);
      }

      const clientId = uuidv4();
      const visit: LocalVisit = {
        clientId,
        deviceId,
        agentId,
        panchayatId: selectedPanchayat,
        shiftId: shiftId,
        checkInAt: now,
        checkInLat: position.lat,
        checkInLng: position.lng,
      };

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
        <h1>{!isOnShift ? "Start Shift & Check In" : t.checkInTitle}</h1>
      </div>
      
      {!isOnShift && (
        <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', padding: '0.85rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#c2410c', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span> Not on Shift
          </div>
          <p style={{ fontSize: '0.8rem', color: '#9a3412', margin: 0 }}>
            Checking in will automatically start your shift for today.
          </p>
        </div>
      )}

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
                panchayats={panchayats}
                onAdded={(p) => setSelectedPanchayat(p.id)}
              />
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {t.noBlockAssignedCheckin}
            </p>
            <div style={{ position: 'relative' }}>
              <input
                id="panchayat-search"
                className="field-input"
                type="text"
                placeholder="Search panchayat…"
                value={showPanchayatList ? panchayatSearch : selectedPanchayatName}
                onChange={(e) => { setPanchayatSearch(e.target.value); setShowPanchayatList(true); }}
                onFocus={() => { setPanchayatSearch(''); setShowPanchayatList(true); }}
                onBlur={() => setTimeout(() => setShowPanchayatList(false), 180)}
                autoComplete="off"
                style={{ minHeight: 52, fontSize: '1rem', paddingRight: selectedPanchayat ? '2.5rem' : undefined }}
              />
              {selectedPanchayat && !showPanchayatList && (
                <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#10b981', fontSize: '1.1rem' }}>✓</span>
              )}
              {showPanchayatList && filteredPanchayats.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                  background: 'white', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto', marginTop: 4,
                }}>
                  {filteredPanchayats.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={() => { setSelectedPanchayat(p.id); setShowPanchayatList(false); setPanchayatSearch(''); }}
                      style={{
                        width: '100%', padding: '0.65rem 0.9rem', background: p.id === selectedPanchayat ? 'rgba(99,102,241,0.08)' : 'transparent',
                        border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: '1px solid var(--surface-border)',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.block}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <AddMissingPanchayatButton
                deviceId={deviceId}
                position={position}
                panchayats={panchayats}
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
          : (!isOnShift ? "Start Shift & " + t.checkInNow : t.checkInNow)}
      </button>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', marginTop: '1rem' }}>
        {t.gpsWarning}
      </p>
    </div>
  );
}
