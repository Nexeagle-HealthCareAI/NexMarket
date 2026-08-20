'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { useVisit, usePanchayats, useContactsByPanchayat, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';

export default function VisitDetailClient({ clientId }: { clientId: string }) {
  const router = useRouter();
  const deviceId = useAgentStore((s) => s.deviceId);
  const setActiveVisit = useAgentStore((s) => s.setActiveVisit);

  const visit = useVisit(clientId);
  const panchayats = usePanchayats();
  const contacts = useContactsByPanchayat(visit?.panchayatId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { position, permission } = useGeolocation({
    visitId: clientId,
    record: false,
  });

  const panchayat = useMemo(() => {
    return panchayats?.find((p) => p.id === visit?.panchayatId);
  }, [panchayats, visit]);

  async function handleCheckOut() {
    if (!visit || !visit.localId || !deviceId) return;

    setLoading(true);
    setError('');

    // GPS is best-effort here, not required — checkout used to hard-block
    // without a live fix (and disable itself when permission was denied,
    // which the browser never re-prompts for), leaving an agent who lost
    // signal or denied location mid-visit permanently stuck "in progress":
    // unable to check out, and unable to start a new visit while one is
    // still active. Recording the location when it's available is still
    // useful; refusing to let the agent leave when it isn't, isn't.
    const now = new Date().toISOString();
    const updated = {
      ...visit,
      checkOutAt: now,
      checkOutLat: position?.lat,
      checkOutLng: position?.lng,
    };

    try {
      await db.visits.update(visit.localId, {
        checkOutAt: now,
        checkOutLat: position?.lat,
        checkOutLng: position?.lng,
      });
      await addToOutbox(visit.clientId, deviceId, 'visit', updated);
      setActiveVisit(null);
      router.push('/home');
    } catch {
      setError('Failed to save checkout. Try again.');
      setLoading(false);
    }
  }

  if (!visit) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="empty-state-icon">🔍</div>
        <h2>Visit not found</h2>
        <p style={{ fontSize: '0.85rem' }}>This visit record does not exist or was deleted.</p>
        <button className="btn btn-primary" onClick={() => router.push('/history')} style={{ marginTop: '0.5rem' }}>
          Back to History
        </button>
      </div>
    );
  }

  const isCheckedOut = !!visit.checkOutAt;
  const durationMin = isCheckedOut
    ? Math.round((new Date(visit.checkOutAt!).getTime() - new Date(visit.checkInAt).getTime()) / 60000)
    : Math.round((Date.now() - new Date(visit.checkInAt).getTime()) / 60000);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, minHeight: 40 }}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1>Visit Details</h1>
        </div>
      </div>

      {/* Panchayat Info Banner */}
      <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid var(--color-primary-500)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
              {panchayat?.name ?? 'Loading Panchayat…'}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Block: {panchayat?.block ?? '…'} · District: {panchayat?.district ?? '…'}
            </p>
          </div>
          <span className={`badge ${isCheckedOut ? 'badge-online' : 'badge-pending'}`}>
            {isCheckedOut ? 'Completed' : '🟢 In Progress'}
          </span>
        </div>
      </div>

      {/* Timing Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ padding: '0.75rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Check In</p>
          <p style={{ fontWeight: 600, marginTop: '0.25rem', fontSize: '0.95rem' }}>
            {new Date(visit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
            📍 {visit.checkInLat.toFixed(4)}, {visit.checkInLng.toFixed(4)}
          </p>
        </div>
        <div className="card" style={{ padding: '0.75rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {isCheckedOut ? 'Check Out' : 'Duration'}
          </p>
          <p style={{ fontWeight: 600, marginTop: '0.25rem', fontSize: '0.95rem' }}>
            {isCheckedOut
              ? new Date(visit.checkOutAt!).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              : `${durationMin} mins so far`}
          </p>
          {isCheckedOut && visit.checkOutLat && visit.checkOutLng ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
              📍 {visit.checkOutLat.toFixed(4)}, {visit.checkOutLng.toFixed(4)}
            </p>
          ) : null}
        </div>
      </div>

      {/* Check Out Action Area */}
      {!isCheckedOut && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>End Panchayat Visit</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Record your exit location when you leave {panchayat?.name ?? 'this panchayat'}.
          </p>

          <div
            className={`gps-banner ${permission === 'granted' && position ? 'locked' : permission === 'denied' ? 'denied' : 'acquiring'}`}
            style={{ marginBottom: '0.75rem' }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" />
              <circle cx={12} cy={9} r={3} />
            </svg>
            {permission === 'granted' && position
              ? `GPS locked · ±${Math.round(position.accuracyM)}m`
              : permission === 'denied'
              ? 'GPS denied — checkout will be recorded without a location'
              : 'Acquiring GPS… checkout works without it too'}
          </div>

          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

          <button
            id="checkout-btn"
            className="btn btn-danger btn-full btn-lg"
            onClick={handleCheckOut}
            disabled={loading}
          >
            {loading ? 'Recording Checkout…' : '📍 Check Out of Panchayat'}
          </button>
        </div>
      )}

      {/* Contacts logged in this Panchayat */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ color: 'var(--text-secondary)' }}>Contacts in {panchayat?.name ?? 'Panchayat'}</h3>
        <Link href="/contacts/new" className="btn btn-primary btn-sm">
          + Add Contact
        </Link>
      </div>

      {!contacts || contacts.length === 0 ? (
        <div className="empty-state" style={{ padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '0.85rem' }}>No contacts recorded in this panchayat yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {contacts.map((c) => (
            <Link key={c.clientId} href={`/contacts/${c.clientId}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{c.name}</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {c.phone ? `📞 ${c.phone}` : 'No phone logged'}
                    </p>
                  </div>
                  <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--color-primary-400)' }}>
                    {c.role.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
