'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Phone, RotateCcw, Search, Star } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import {
  contactTypeLabel, Empty, ErrorBox, fmt, friendlyError, initials, PageHead, Pill, rupees, Skeleton, stageTone, useLoader, useToast,
} from '@/components/crm/ui';

interface CallSummary {
  cycle: { number: number; startDate: string; endDate: string; nextStart: string };
  settings: { cycleDays: number; importantEveryDays: number; maxAttempts: number; retryHourIst: number };
  total: number; calledInCycle: number; connected: number; retry: number; callBack: number; notCalled: number;
  dueToday: number; doneToday: number; important: number; needsVisit: number;
}

interface QueueRow {
  clientId: string; name: string; type: string; profession?: string | null; phone?: string | null; isImportant: boolean; block?: string | null;
  nextCallAt?: string | null; callAttempts: number; lastCallOutcome?: string | null; lastCalledAt?: string | null; lastConnectedAt?: string | null;
  needsVisit: boolean; doneToday: boolean; tag: string;
}

interface ContactPanel {
  clientId: string; name: string; type: string; profession?: string | null; phone?: string | null; isImportant: boolean; status: string; comments?: string | null;
  block?: string | null; panchayat?: string | null; district?: string | null; agentId: string; agentName?: string | null;
  callAttempts: number; lastCallOutcome?: string | null; lastCalledAt?: string | null; lastConnectedAt?: string | null; nextCallAt?: string | null; needsVisit: boolean; whatsappOptOut: boolean;
  patientsSent: number; admitted: number; amountDue: number;
  patients: { clientId: string; patientName: string; department: string; status: string; label: string; createdAt: string }[];
  payments: { id: string; purpose: string; period?: string | null; amount: number; status: string; createdAt: string; paidAt?: string | null }[];
  history: { outcome: string; responses: string[]; note?: string | null; attempt: number; createdAt: string; by: string }[];
}

const FILTERS = [
  { key: 'due', label: 'Due today' },
  { key: 'retry', label: 'Retry' },
  { key: 'important', label: 'Important' },
  { key: 'done', label: 'Done today' },
  { key: 'needs_visit', label: 'Needs visit' },
];

const OUTCOMES = [
  { key: 'connected', label: 'Connected', tone: 'ok' },
  { key: 'no_answer', label: 'Not able to connect', tone: 'warn' },
  { key: 'call_later', label: 'Call back later', tone: 'accent' },
  { key: 'wrong_number', label: 'Wrong number', tone: 'bad' },
] as const;

const RESPONSES = [
  { key: 'refer', label: 'Will refer patients' },
  { key: 'patient_now', label: 'Has a patient now' },
  { key: 'doctor_info', label: 'Wants doctor info' },
  { key: 'camp', label: 'Interested in a camp' },
  { key: 'complaint', label: 'Has a complaint' },
  { key: 'not_interested', label: 'Not interested now' },
];

const OUTCOME_LABEL: Record<string, string> = { connected: 'Connected', no_answer: 'Not able to connect', call_later: 'Call back later', wrong_number: 'Wrong number' };

function defaultCallBack(): string {
  // two hours from now, in local time, for <input type="datetime-local">
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DailyCallsPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <DailyCalls />
    </Suspense>
  );
}

function DailyCalls() {
  const params = useSearchParams();
  const { access } = useAccess();
  const editable = canEdit(access, 'calls');
  const [filter, setFilter] = useState(params?.get('filter') ?? 'due');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const summary = useLoader(() => crm.get<CallSummary>('/api/v1/calls/summary'));
  const queue = useLoader(
    () => crm.get<QueueRow[]>(`/api/v1/calls/queue?filter=${filter}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`),
    [filter, search],
  );

  const rows = useMemo(() => queue.data ?? [], [queue.data]);
  // Keep a valid selection: first row by default.
  const selectedId = selected && rows.some((r) => r.clientId === selected) ? selected : rows[0]?.clientId ?? null;

  const afterSave = useCallback((msg: string) => {
    showToast(msg);
    const currentIndex = rows.findIndex((r) => r.clientId === selectedId);
    const next = rows.slice(currentIndex + 1).find((r) => !r.doneToday) ?? rows.find((r) => r.clientId !== selectedId && !r.doneToday);
    setSelected(next?.clientId ?? null);
    void queue.reload();
    void summary.reload();
  }, [rows, selectedId, queue, summary, showToast]);

  const s = summary.data;
  const pct = (n: number) => (s && s.total ? `${Math.round((n / s.total) * 100)}%` : '0%');

  return (
    <main className="crm-page">
      <PageHead title="Daily calls" sub="Call every partner once per cycle, log what they said, and the system schedules the next call." />

      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}

      <section className="crm-card" aria-labelledby="cycle-h" style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 32px', alignItems: 'center' }}>
        {!s ? <Skeleton h={64} /> : (
          <>
            <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <h2 id="cycle-h" style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Calling cycle {s.cycle.number}</h2>
                <span className="crm-sub">{fmt.date(s.cycle.startDate)} – {fmt.date(s.cycle.endDate)} · every partner once</span>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', display: 'flex' }} role="img"
                aria-label={`${s.calledInCycle} of ${s.total} partners called this cycle`}>
                <div style={{ width: pct(s.connected), background: 'var(--ok)' }} />
                <div style={{ width: pct(Math.max(0, s.calledInCycle - s.connected)), background: 'var(--warn)' }} />
              </div>
              <span className="crm-sub" style={{ fontSize: 13 }}>
                {s.calledInCycle} of {s.total} partners called · cycle {s.cycle.number + 1} starts {fmt.date(s.cycle.nextStart)}, or earlier once everyone is called
              </span>
            </div>
            <dl style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <Stat label="Connected" value={s.connected} tone="ok" />
              <Stat label="Retry tomorrow" value={s.retry} tone="warn" />
              <Stat label="Call back later" value={s.callBack} tone="accent" />
              <Stat label="Not called yet" value={s.notCalled} tone="neutral" />
            </dl>
          </>
        )}
      </section>

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="queue-h" style={{ padding: '18px 14px', flexBasis: 340 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 6px 12px', flexWrap: 'wrap' }}>
            <h2 id="queue-h" className="crm-h2">Today&apos;s calls</h2>
            {s && <span className="crm-sub" style={{ fontSize: 13 }}>{s.doneToday} done · {s.dueToday} due</span>}
          </div>
          <div className="crm-chips" role="tablist" aria-label="Which calls" style={{ padding: '0 6px 12px' }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" className="crm-chip" aria-selected={filter === f.key} onClick={() => { setFilter(f.key); setSelected(null); }}>
                {f.label}
                {f.key === 'needs_visit' && s && s.needsVisit > 0 && <span style={{ opacity: 0.75 }}>{s.needsVisit}</span>}
              </button>
            ))}
          </div>
          <label className="crm-search" style={{ margin: '0 6px 10px', flex: 'none', minWidth: 0 }}>
            <Search size={16} color="#5a6478" aria-hidden />
            <span className="crm-sr">Search partners</span>
            <input type="search" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>

          {queue.error && <ErrorBox message={queue.error} onRetry={queue.reload} />}
          {queue.loading && !queue.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 6px' }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={64} />)}</div>
          ) : rows.length === 0 ? (
            <Empty title={filter === 'due' ? 'All calls done for today' : 'Nobody here'}>
              {filter === 'due' ? 'New calls appear as partners become due.' : 'Try another filter.'}
            </Empty>
          ) : (
            <ul className="crm-list" style={{ gap: 4 }}>
              {rows.map((r) => {
                const sel = r.clientId === selectedId;
                const tone = r.doneToday ? 'ok' : r.needsVisit ? 'bad' : r.lastCallOutcome === 'no_answer' ? 'warn' : r.isImportant ? 'warn' : 'accent';
                return (
                  <li key={r.clientId} style={{ border: 0, padding: 0 }}>
                    <button type="button" onClick={() => setSelected(r.clientId)} aria-current={sel ? 'true' : undefined}
                      style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 14,
                        border: sel ? '2px solid var(--accent)' : '1px solid transparent', background: sel ? 'var(--accent-tint)' : '#fff', color: 'var(--text)', cursor: 'pointer' }}>
                      <span className="crm-initials" style={{ width: 40, height: 40 }}>{initials(r.name)}</span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                          {r.isImportant && <Star size={14} fill="#d9822b" color="#d9822b" aria-label="Important" style={{ flexShrink: 0 }} />}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[contactTypeLabel(r.type), r.block].filter(Boolean).join(' · ')}</span>
                        <span style={{ alignSelf: 'flex-start' }}><Pill tone={tone}>{r.tag}</Pill></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="crm-card grow-2" style={{ flexBasis: 560 }} aria-live="polite">
          {selectedId ? (
            <ContactCallPanel key={selectedId} clientId={selectedId} editable={editable} maxAttempts={s?.settings.maxAttempts ?? 3}
              importantEvery={s?.settings.importantEveryDays ?? 7} onSaved={afterSave} onImportantChanged={() => { void queue.reload(); void summary.reload(); }} />
          ) : (
            <Empty title="Pick someone to call">Choose a partner from the list on the left.</Empty>
          )}
        </section>
      </div>
      {toast}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'accent' | 'neutral' }) {
  const bg = { ok: 'var(--ok-soft)', warn: 'var(--warn-soft)', accent: 'var(--accent-soft)', neutral: 'var(--grey-soft)' }[tone];
  const fg = { ok: 'var(--ok-ink)', warn: 'var(--warn-ink)', accent: 'var(--accent-ink)', neutral: 'var(--text-3)' }[tone];
  return (
    <div style={{ minWidth: 116, padding: '10px 14px', borderRadius: 12, background: bg }}>
      <dt style={{ fontSize: 12, color: fg, fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800, color: fg }}>{value}</dd>
    </div>
  );
}

function ContactCallPanel({ clientId, editable, maxAttempts, importantEvery, onSaved, onImportantChanged }: {
  clientId: string; editable: boolean; maxAttempts: number; importantEvery: number; onSaved: (msg: string) => void; onImportantChanged: () => void;
}) {
  const { data: c, error, reload, setData } = useLoader(() => crm.get<ContactPanel>(`/api/v1/calls/contact/${encodeURIComponent(clientId)}`), [clientId]);
  const [tab, setTab] = useState<'call' | 'patients' | 'payments' | 'history'>('call');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [responses, setResponses] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [callBack, setCallBack] = useState(defaultCallBack);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!c) return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Skeleton h={56} /><Skeleton h={80} /><Skeleton h={200} /></div>;

  const toggleImportant = async () => {
    const next = !c.isImportant;
    setData({ ...c, isImportant: next });
    try {
      await crm.put(`/api/v1/calls/contact/${encodeURIComponent(c.clientId)}/important`, { isImportant: next });
      onImportantChanged();
    } catch (e) {
      setData({ ...c, isImportant: !next });
      setSaveError(friendlyError(e));
    }
  };

  const save = async () => {
    if (!outcome) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await crm.post<{ attempt: number; maxAttempts: number; needsVisit: boolean }>('/api/v1/calls', {
        contactClientId: c.clientId,
        outcome,
        responses: outcome === 'connected' ? responses : [],
        note: note.trim() || null,
        callBackAt: outcome === 'call_later' ? new Date(callBack).toISOString() : null,
      });
      const msg = outcome === 'connected' ? `Saved. ${c.name} is done for this cycle.`
        : outcome === 'no_answer' ? (res.needsVisit ? `${c.name} missed ${maxAttempts} calls — the field agent will be asked to visit.` : `${c.name} moved to tomorrow's list (attempt ${res.attempt} of ${maxAttempts}).`)
        : outcome === 'call_later' ? `Call back scheduled for ${fmt.dateTime(new Date(callBack).toISOString())}.`
        : `${c.name} marked as wrong number.`;
      onSaved(msg);
    } catch (e) {
      setSaveError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const nextAttempt = c.lastCallOutcome === 'no_answer' ? c.callAttempts + 1 : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <span className="crm-initials" style={{ width: 56, height: 56, borderRadius: 16, fontSize: 19, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 800 }}>{initials(c.name)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, marginRight: 'auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>{c.name}</h2>
          <span className="crm-sub">{[contactTypeLabel(c.type), c.profession, c.panchayat, c.block].filter(Boolean).join(' · ')}</span>
          <span className="crm-sub">{c.phone ?? 'No phone'}{c.agentName ? ` · field agent ${c.agentName}` : ''}</span>
        </div>
        <button type="button" className="crm-btn is-secondary" onClick={toggleImportant} aria-pressed={c.isImportant} disabled={!editable}
          style={c.isImportant ? { borderColor: 'var(--warn)', background: 'var(--warn-soft)', color: 'var(--warn-ink)' } : undefined}>
          <Star size={18} fill={c.isImportant ? '#d9822b' : 'none'} aria-hidden />
          {c.isImportant ? 'Important · aligned' : 'Mark important'}
        </button>
        {c.phone && (
          <a href={`tel:${c.phone}`} className="crm-btn is-ok" style={{ color: '#fff' }}>
            <Phone size={18} aria-hidden /> Call now
          </a>
        )}
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <Fact label="Patients sent" value={String(c.patientsSent)} />
        <Fact label="Admitted" value={String(c.admitted)} />
        <Fact label="Amount due" value={rupees(c.amountDue)} warn={c.amountDue > 0} />
        <Fact label="Last connected" value={c.lastConnectedAt ? fmt.date(c.lastConnectedAt) : 'Never'} small />
      </dl>

      {c.needsVisit && (
        <div className="crm-note" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {maxAttempts} calls missed in a row — {c.agentName ?? 'the field agent'} should visit in person.
        </div>
      )}

      <div className="crm-tabs" role="tablist" aria-label="Partner">
        {([['call', 'Log this call'], ['patients', `Patients (${c.patients.length})`], ['payments', 'Payments'], ['history', 'Call history']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" className="crm-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'call' && (
        !editable ? <div className="crm-note">You can view this partner but not log calls. Ask an admin for edit access to Daily calls.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <legend style={{ fontSize: 14, fontWeight: 700, paddingBottom: 10 }}>How did the call go?</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {OUTCOMES.map((o) => {
                  const on = outcome === o.key;
                  const color = { ok: ['var(--ok)', 'var(--ok-soft)', 'var(--ok-ink)'], warn: ['var(--warn)', 'var(--warn-soft)', 'var(--warn-ink)'], accent: ['var(--accent)', 'var(--accent-tint)', 'var(--accent-ink)'], bad: ['var(--bad)', 'var(--bad-soft)', 'var(--bad)'] }[o.tone];
                  return (
                    <button key={o.key} type="button" aria-pressed={on} onClick={() => { setOutcome(o.key); setSaveError(null); }}
                      style={{ minHeight: 56, borderRadius: 14, border: on ? `2px solid ${color[0]}` : '1px solid var(--border)', background: on ? color[1] : '#fff', color: on ? color[2] : 'var(--text)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {outcome === 'connected' && (
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <legend style={{ fontSize: 14, fontWeight: 700, paddingBottom: 10 }}>What did they say? (pick all that apply)</legend>
                <div className="crm-chips">
                  {RESPONSES.map((r) => {
                    const on = responses.includes(r.key);
                    return (
                      <button key={r.key} type="button" className="crm-chip is-soft" aria-pressed={on}
                        onClick={() => setResponses((x) => (on ? x.filter((y) => y !== r.key) : [...x, r.key]))}>
                        {on && <Check size={14} aria-hidden />}{r.label}
                      </button>
                    );
                  })}
                </div>
                <div className="crm-note" style={{ background: 'var(--ok-soft)', color: 'var(--ok-ink)', fontWeight: 600 }}>
                  {c.isImportant ? `Done for this cycle · important partners are called again in ${importantEvery} days` : 'Done for this cycle · next call in the next cycle'}
                </div>
              </fieldset>
            )}

            {outcome === 'no_answer' && (
              <div className="crm-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)', display: 'flex', gap: 10 }}>
                <RotateCcw size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  {nextAttempt >= maxAttempts
                    ? <><strong>This is attempt {maxAttempts} of {maxAttempts}.</strong> The partner moves to the next cycle and the field agent is asked to visit in person.</>
                    : <><strong>Moved to tomorrow&apos;s list · attempt {nextAttempt} of {maxAttempts}.</strong> After {maxAttempts} missed calls the field agent is asked to visit.</>}
                </span>
              </div>
            )}

            {outcome === 'call_later' && (
              <label className="crm-field" style={{ maxWidth: 300 }}>Call back on
                <input type="datetime-local" className="crm-input" value={callBack} onChange={(e) => setCallBack(e.target.value)} />
              </label>
            )}

            {outcome && (
              <label className="crm-field">Note (optional)
                <textarea className="crm-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Has a pregnant patient due next week, wants the obstetrician's OPD days" />
              </label>
            )}

            {saveError && <div className="crm-error" role="alert">{saveError}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="crm-btn is-lg" disabled={!outcome || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save and next call'}
              </button>
            </div>
          </div>
        )
      )}

      {tab === 'patients' && (c.patients.length === 0 ? <Empty title="No patients referred yet" /> : (
        <ul className="crm-list">
          {c.patients.map((p) => (
            <li key={p.clientId}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.patientName}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.department || '—'} · referred {fmt.date(p.createdAt)}</span>
              </span>
              <span style={{ marginLeft: 'auto' }}><Pill tone={stageTone(p.status)}>{p.label}</Pill></span>
            </li>
          ))}
        </ul>
      ))}

      {tab === 'payments' && (c.payments.length === 0 ? <Empty title="No payments recorded" /> : (
        <ul className="crm-list">
          {c.payments.map((p) => (
            <li key={p.id}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.purpose}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.period ?? fmt.date(p.createdAt)}</span>
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{rupees(p.amount)}</span>
              <Pill tone={p.status === 'paid' ? 'ok' : p.status === 'approved' ? 'warn' : p.status === 'rejected' ? 'neutral' : 'accent'}>
                {p.status === 'pending_approval' ? 'Waiting approval' : p.status === 'approved' ? 'To be paid' : p.status === 'paid' ? 'Paid' : 'Rejected'}
              </Pill>
            </li>
          ))}
        </ul>
      ))}

      {tab === 'history' && (c.history.length === 0 ? <Empty title="No calls yet" /> : (
        <ol className="crm-list">
          {c.history.map((h, i) => (
            <li key={i} style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, marginTop: 5, flexShrink: 0, background: h.outcome === 'connected' ? 'var(--ok)' : h.outcome === 'no_answer' ? 'var(--warn)' : h.outcome === 'wrong_number' ? 'var(--bad)' : 'var(--accent)' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14 }}><strong>{OUTCOME_LABEL[h.outcome] ?? h.outcome}</strong>{h.responses.length > 0 && ` · ${h.responses.join(', ').toLowerCase()}`}</span>
                {h.note && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>“{h.note}”</span>}
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmt.dateTime(h.createdAt)} · {h.by}</span>
              </span>
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}

function Fact({ label, value, warn, small }: { label: string; value: string; warn?: boolean; small?: boolean }) {
  return (
    <div style={{ background: warn ? 'var(--warn-soft)' : 'var(--bg)', borderRadius: 14, padding: '12px 14px' }}>
      <dt style={{ fontSize: 12, color: warn ? 'var(--warn-ink)' : 'var(--text-2)' }}>{label}</dt>
      <dd style={{ margin: '4px 0 0', fontSize: small ? 16 : 22, fontWeight: small ? 700 : 800, color: warn ? 'var(--warn-ink)' : 'var(--text)' }}>{value}</dd>
    </div>
  );
}
