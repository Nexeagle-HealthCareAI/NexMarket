'use client';

import { useState } from 'react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { useActiveShift, useActiveVisit, useContacts, useVisits, useOutboxCount, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { triggerManualSync } from '@/lib/sync/engine';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import type { LocalShift } from '@/lib/db/schema';

export default function HomeClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const name = useAgentStore((s) => s.name);
  const setActiveShift = useAgentStore((s) => s.setActiveShift);

  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);
  const contacts = useContacts(agentId ?? undefined);
  const visits = useVisits(agentId ?? undefined);
  const outboxCount = useOutboxCount();

  const { position, permission } = useGeolocation({
    shiftId: activeShift?.clientId,
    record: !!activeShift,
  });

  const [syncing, setSyncing] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);

  const isOnShift = !!activeShift && !activeShift.endAt;

  async function handleStartShift() {
    if (!agentId || !deviceId) return;
    setShiftLoading(true);
    const clientId = uuidv4();
    const shift: LocalShift = { clientId, deviceId, agentId, startAt: new Date().toISOString() };
    await db.shifts.add(shift);
    await addToOutbox(clientId, deviceId, 'shift', shift);
    setActiveShift(clientId);
    setShiftLoading(false);
  }

  async function handleEndShift() {
    if (!activeShift?.localId || !agentId || !deviceId) return;
    setShiftLoading(true);
    const endAt = new Date().toISOString();
    await db.shifts.update(activeShift.localId, { endAt });
    await addToOutbox(activeShift.clientId, deviceId, 'shift', { ...activeShift, endAt });
    setActiveShift(null);
    setShiftLoading(false);
  }

  async function handleManualSync() {
    setSyncing(true);
    await triggerManualSync();
    setSyncing(false);
  }

  const todayContacts = contacts?.filter(
    (c) => new Date(c.createdAt).toDateString() === new Date().toDateString()
  ).length ?? 0;

  const todayVisits = visits?.filter(
    (v) => new Date(v.checkInAt).toDateString() === new Date().toDateString()
  ).length ?? 0;

  return (
    <div style={{ paddingTop: '1rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.3rem' }}>Namaste, {name?.split(' ')[0] ?? 'Agent'} 🙏</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="sync-indicator">
          {syncing ? (
            <><svg className="spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 11-4.219-7.64" /></svg>Syncing…</>
          ) : outboxCount && outboxCount > 0 ? (
            <button id="sync-now-btn" onClick={handleManualSync} style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-full)', color: 'var(--color-warning)', fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 12a9 9 0 11-4.219-7.64" /></svg>
              {outboxCount} pending
            </button>
          ) : (
            <span className="badge badge-online">Synced</span>
          )}
        </div>
      </div>

      {/* GPS status */}
      <div className={`gps-banner ${permission === 'granted' && position ? 'locked' : permission === 'denied' ? 'denied' : 'acquiring'}`} style={{ marginBottom: '1rem' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx={12} cy={9} r={3} /></svg>
        {permission === 'granted' && position ? `GPS locked · ±${Math.round(position.accuracyM)}m` : permission === 'denied' ? 'GPS denied — enable location in browser settings' : 'Acquiring GPS…'}
      </div>

      {/* Shift banner */}
      <div className="shift-banner" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Today's Shift</p>
            {isOnShift ? (
              <p style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: '0.95rem', marginTop: '0.125rem' }}>
                🟢 On shift since {new Date(activeShift!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.125rem' }}>Not started</p>
            )}
          </div>
          <button id={isOnShift ? 'end-shift-btn' : 'start-shift-btn'} className={`btn btn-sm ${isOnShift ? 'btn-danger' : 'btn-primary'}`} onClick={isOnShift ? handleEndShift : handleStartShift} disabled={shiftLoading || permission === 'denied'}>
            {shiftLoading ? '…' : isOnShift ? 'End Shift' : 'Start Shift'}
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid-cols-responsive-3" style={{ marginBottom: '1.75rem' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-600)' }}>{todayContacts}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Today's Contacts</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#d97706' }}>{todayVisits}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Today's Visits</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-success)' }}>{contacts?.length ?? 0}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Contacts</p>
        </div>
      </div>

      {/* Quick actions */}
      <h3 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>Quick Actions</h3>
      <div className="grid-cols-responsive-2">
        {activeVisit ? (
          <Link href={`/visit/${activeVisit.clientId}`} className="card" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📍</span>
            <div>
              <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Active Visit in Progress</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-warning)' }}>Started {new Date(activeVisit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · Tap to check out</p>
            </div>
          </Link>
        ) : (
          <Link href="/visit" className="card" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: isOnShift ? 1 : 0.5, pointerEvents: isOnShift ? 'auto' : 'none' }}>
            <span style={{ fontSize: '1.5rem' }}>📍</span>
            <div>
              <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Check In to Panchayat</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isOnShift ? 'Record your current location' : 'Start a shift first'}</p>
            </div>
          </Link>
        )}

        <Link href="/contacts/new" className="card" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>👤</span>
          <div>
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Add New Contact</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Channel Partner · Key Account · Local Rep</p>
          </div>
        </Link>

        <Link href="/contacts" className="card" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>📋</span>
          <div>
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>View All Contacts</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{contacts?.length ?? 0} contacts saved locally</p>
          </div>
        </Link>
      </div>

      <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        💾 All data is saved on your device. Works without internet.
      </div>
    </div>
  );
}
