'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { ReferralCard, type ReferralRow } from '@/components/crm/ReferralCard';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { useLiveEvents, useNow } from '@/lib/crm/live';
import {
  Empty, ErrorBox, fmt, initials, PageHead, Pill, Skeleton, stageTone, useLoader, useToast,
} from '@/components/crm/ui';

export default function ReferralDeskPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'desk') || canEdit(access, 'pipeline');
  const [q, setQ] = useState('');
  const [rawResults, setResults] = useState<ReferralRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ReferralRow | null>(null);
  const [toast, showToast] = useToast();
  const expected = useLoader(() => crm.get<{ arrivedToday: number; items: ReferralRow[] }>('/api/v1/referrals/expected'));

  // Live: refresh the expected list when anything changes on referrals.
  const onEvent = useCallback((e: { kind: string }) => {
    if (['referral', 'arrived', 'opd', 'admit', 'discharged', 'lost'].includes(e.kind)) void expected.reload();
  }, [expected]);
  useLiveEvents(onEvent);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await crm.get<ReferralRow[]>(`/api/v1/referrals/search?q=${encodeURIComponent(term)}`);
        setResults(rows);
        if (rows.length === 1) setSelected(rows[0]);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const results = q.trim().length < 3 ? null : rawResults;

  const updated = (r: ReferralRow, label: string) => {
    showToast(`${r.patientName}: ${label.toLowerCase()} — the agent has been notified.`);
    setSelected(r);
    setResults((list) => list?.map((x) => (x.clientId === r.clientId ? r : x)) ?? null);
    void expected.reload();
  };

  return (
    <main className="crm-page">
      <PageHead title="Referral desk" sub="Find a referred patient when they arrive and update their stage. The field agent and partner see it straight away." />

      <section className="crm-card" aria-labelledby="find-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 id="find-h" style={{ fontSize: 20, fontWeight: 800 }}>Find a referred patient</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, height: 60, padding: '0 18px', border: '2px solid var(--accent)', borderRadius: 14, background: '#fff' }}>
          <Search size={22} color="var(--accent)" aria-hidden />
          <span className="crm-sr">Patient phone, name or referral code</span>
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient phone, name or referral code"
            style={{ border: 0, outline: 'none', font: 'inherit', fontSize: 20, flex: 1, minWidth: 0, background: 'transparent', color: 'var(--text)' }} />
        </label>
        <span className="crm-sub" style={{ fontSize: 13 }}>
          {q.trim().length < 3 ? 'Type at least 3 characters — the last digits of the phone number work best.' : searching ? 'Searching…' : `${results?.length ?? 0} match${results?.length === 1 ? '' : 'es'}`}
        </span>
        {results && results.length > 1 && (
          <ul className="crm-list">
            {results.map((r) => (
              <li key={r.clientId}>
                <button type="button" onClick={() => setSelected(r)} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>
                  <span className="crm-initials">{initials(r.patientName)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{r.patientName}</span>
                    <span className="crm-cell-sub">{[r.department, r.contactName, fmt.date(r.createdAt)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}><Pill tone={stageTone(r.status)}>{r.stageLabel}</Pill></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {results && results.length === 0 && !searching && <Empty title="No referral found">Check the number, or ask the patient who referred them.</Empty>}
      </section>

      <div className="crm-row">
        <section className="crm-card grow-3" style={{ flexBasis: 560 }} aria-label="Selected referral">
          {selected ? <ReferralCard key={selected.clientId} r={selected} editable={editable} onUpdated={updated} />
            : <Empty title="No patient selected">Search above, or pick someone from today&apos;s expected list.</Empty>}
        </section>

        <aside className="crm-card grow-1" aria-labelledby="exp-h" style={{ flexBasis: 340 }}>
          <div className="crm-card-head">
            <h2 id="exp-h" className="crm-h2">Expected</h2>
            {expected.data && <span className="crm-sub" style={{ fontSize: 13 }}>{expected.data.items.length} referred in the last 7 days · {expected.data.arrivedToday} arrived today</span>}
          </div>
          {expected.error && <ErrorBox message={expected.error} onRetry={expected.reload} />}
          {!expected.data ? <Skeleton h={240} /> : expected.data.items.length === 0 ? <Empty title="Nobody waiting">Every recent referral has arrived.</Empty> : (
            <ul className="crm-list">
              {expected.data.items.map((r) => (
                <ExpectedRow key={r.clientId} r={r} editable={editable} onOpen={() => setSelected(r)} onUpdated={updated} />
              ))}
            </ul>
          )}
        </aside>
      </div>
      {toast}
    </main>
  );
}

function ExpectedRow({ r, editable, onOpen, onUpdated }: { r: ReferralRow; editable: boolean; onOpen: () => void; onUpdated: (r: ReferralRow, label: string) => void }) {
  const [busy, setBusy] = useState(false);
  const now = useNow(60000);
  const waitingDays = Math.floor((now - new Date(r.createdAt).getTime()) / 86400000);
  const markArrived = async () => {
    setBusy(true);
    try {
      await crm.put(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/status`, { status: 'arrived' });
      onUpdated({ ...r, status: 'arrived', stageLabel: 'Arrived', arrivedAt: new Date().toISOString() }, 'Arrived');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <button type="button" onClick={onOpen} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, border: 0, background: 'transparent', textAlign: 'left', padding: 0, cursor: 'pointer', color: 'var(--text)' }}>
        <span style={{ fontSize: 15, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>{r.patientName}{r.urgent && <Pill tone="bad">Urgent</Pill>}</span>
        <span style={{ fontSize: 12, color: waitingDays >= 2 ? 'var(--bad)' : 'var(--text-2)' }}>
          {[r.department, r.block].filter(Boolean).join(' · ')}{waitingDays >= 1 ? ` · waiting ${waitingDays} day${waitingDays === 1 ? '' : 's'}` : ' · today'}
        </span>
      </button>
      {editable && (
        <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={markArrived}
          style={{ borderColor: 'var(--info)', color: 'var(--info-ink)', flexShrink: 0 }}>
          {busy ? '…' : 'Mark arrived'}
        </button>
      )}
    </li>
  );
}

