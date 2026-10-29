'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MessageCircle, Phone, Search, Star } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, contactTypeLabel, fmt, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useLoader, useToast, type Tone } from '@/components/crm/ui';

type Tab = 'all' | 'follow' | 'champ' | 'escalated' | 'dup';
type Priority = 'very_high' | 'high' | 'normal' | 'low';
type FollowState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

interface Row {
  clientId: string; name: string; type: string; profession?: string | null; phone?: string | null;
  panchayat?: string | null; block?: string | null; agentName: string; priority: Priority; champion: boolean;
  followUpDate?: string | null; followState: FollowState; referrals90: number; admitted90: number; escalated: boolean;
}
interface ListRes { counts: { all: number; follow: number; champ: number; escalated: number; dup: number }; total: number; page: number; pageSize: number; rows: Row[] }
interface Filters { blocks: { block: string; district: string }[]; agents: { agentId: string; name: string }[]; types: { type: string; count: number }[] }
interface Detail {
  clientId: string; name: string; type: string; profession?: string | null; phone?: string | null; status: string;
  priority: Priority; champion: boolean; championNote?: string | null; championSetBy?: string | null;
  followUpDate?: string | null; followState: FollowState; panchayat?: string | null; block?: string | null; district?: string | null;
  agentName: string; createdAt: string; lastVisit?: string | null; lastCalledAt?: string | null; whatsappOptOut: boolean; phoneInvalid: boolean;
  escalation?: { note?: string | null; resolved: boolean; resolution?: string | null } | null;
  stats: { referrals90: number; admitted90: number; referralsAll: number; admittedAll: number };
  referrals: { clientId: string; patientName: string; department?: string | null; createdAt: string; status: string; label: string }[];
  timeline: { kind: 'note' | 'visit' | 'call' | 'change'; text: string; by: string; at: string; fromApp: boolean }[];
  survey: { done: boolean; skipped: boolean; at?: string | null; answers: { question: string; answer: string }[] };
}
interface DupRecord { clientId: string; name: string; role: string; phone?: string | null; agentName: string; panchayatName: string; createdAt: string }
interface DupRes { totalCount: number; items: { id: string; recordA: DupRecord; recordB: DupRecord; status: string }[] }

const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  very_high: { label: 'Very high', tone: 'bad' },
  high: { label: 'High', tone: 'warn' },
  normal: { label: 'Normal', tone: 'accent' },
  low: { label: 'Low', tone: 'neutral' },
};
const PRIORITY_KEYS: Priority[] = ['very_high', 'high', 'normal', 'low'];
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All partners' },
  { key: 'follow', label: 'Follow-ups due' },
  { key: 'champ', label: 'Champions' },
  { key: 'escalated', label: 'Escalations' },
  { key: 'dup', label: 'Possible duplicates' },
];
const KIND_META: Record<Detail['timeline'][number]['kind'], { letter: string; label: string; bg: string; fg: string }> = {
  visit: { letter: 'V', label: 'Visit', bg: 'var(--ok-soft)', fg: 'var(--ok-ink)' },
  call: { letter: 'C', label: 'Call', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  note: { letter: 'N', label: 'Note', bg: 'var(--grey-soft)', fg: 'var(--text-3)' },
  change: { letter: 'S', label: 'Update', bg: 'var(--warn-soft)', fg: 'var(--warn-ink)' },
};

function followText(d?: string | null, s?: FollowState) {
  if (!d || s === 'none') return 'Not set';
  if (s === 'today') return 'Today';
  if (s === 'overdue') return `Overdue · ${fmt.date(d)}`;
  return fmt.date(d);
}
function followColor(s: FollowState) {
  return s === 'overdue' ? 'var(--bad)' : s === 'today' ? 'var(--warn-ink)' : s === 'none' ? 'var(--text-2)' : 'var(--text)';
}
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default function PartnersPageWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <PartnersPage />
    </Suspense>
  );
}

function PartnersPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const editable = canEdit(access, 'partners');

  const tab = (params.get('tab') as Tab) || 'all';
  const selected = params.get('id');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [block, setBlock] = useState('');
  const [type, setType] = useState('');
  const [agentId, setAgentId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const go = (next: { tab?: Tab; id?: string | null }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.tab !== undefined) { if (next.tab === 'all') sp.delete('tab'); else sp.set('tab', next.tab); }
    if (next.id !== undefined) { if (next.id) sp.set('id', next.id); else sp.delete('id'); }
    const s = sp.toString();
    router.replace(s ? `/admin/partners?${s}` : '/admin/partners', { scroll: false });
  };

  const qs = useMemo(() => {
    const sp = new URLSearchParams({ tab: tab === 'dup' ? 'all' : tab, page: String(page), pageSize: '25' });
    if (priority) sp.set('priority', priority);
    if (block) sp.set('block', block);
    if (type) sp.set('type', type);
    if (agentId) sp.set('agentId', agentId);
    if (q) sp.set('q', q);
    return sp.toString();
  }, [tab, page, priority, block, type, agentId, q]);

  const list = useLoader(() => crm.get<ListRes>(`/api/v1/partners?${qs}`), [qs]);
  const filters = useLoader(() => crm.get<Filters>('/api/v1/partners/filters'), []);
  const dups = useLoader(() => (tab === 'dup' ? crm.get<DupRes>('/api/v1/duplicates?status=pending&pageSize=50') : Promise.resolve(null)), [tab]);

  const counts = list.data?.counts;
  const rows = list.data?.rows ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const resetPage = () => setPage(1);

  const updateRow = (clientId: string, patch: Partial<Row>) => {
    if (!list.data) return;
    list.setData({ ...list.data, rows: list.data.rows.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)) });
  };

  return (
    <main className="crm-page">
      <PageHead title="Partners" sub="Doctors, ASHAs, chemists and RMPs who send patients. Priority and notes come from agents in the field and from the call desk." />

      <div className="crm-tabs" role="tablist" aria-label="Partner views">
        {TABS.filter((t) => t.key !== 'escalated' || tab === 'escalated' || (counts?.escalated ?? 0) > 0).map((t) => (
          <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key}
            onClick={() => { go({ tab: t.key, id: null }); resetPage(); }}>
            {t.label}
            {counts && <span className="pt-count" data-tone={(t.key === 'dup' || t.key === 'escalated') && counts[t.key] > 0 ? 'warn' : undefined}>{counts[t.key].toLocaleString('en-IN')}</span>}
          </button>
        ))}
      </div>

      {tab === 'dup' ? (
        <Duplicates data={dups.data} error={dups.error} reload={() => { void dups.reload(); void list.reload(); }} editable={editable} showToast={showToast} />
      ) : (
        <>
          <div className="crm-chips" style={{ alignItems: 'center' }}>
            <label className="crm-search" style={{ flex: '1 1 260px' }}>
              <Search size={16} aria-hidden color="var(--text-2)" />
              <span className="crm-sr">Search partners</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or panchayat" style={{ border: 0, outline: 0, flex: 1, font: 'inherit', fontSize: 14, background: 'transparent' }} />
            </label>
            <div className="pt-seg" role="group" aria-label="Priority">
              <button type="button" aria-pressed={priority === ''} onClick={() => { setPriority(''); resetPage(); }}>Any</button>
              {PRIORITY_KEYS.map((k) => (
                <button key={k} type="button" aria-pressed={priority === k} onClick={() => { setPriority(k); resetPage(); }}>{PRIORITY[k].label}</button>
              ))}
            </div>
            <label className="crm-sr" htmlFor="pt-block">Block</label>
            <select id="pt-block" className="crm-select" style={{ width: 'auto' }} value={block} onChange={(e) => { setBlock(e.target.value); resetPage(); }}>
              <option value="">All blocks</option>
              {filters.data?.blocks.map((b) => <option key={`${b.district}-${b.block}`} value={b.block}>{b.block} ({b.district})</option>)}
            </select>
            <label className="crm-sr" htmlFor="pt-type">Type</label>
            <select id="pt-type" className="crm-select" style={{ width: 'auto' }} value={type} onChange={(e) => { setType(e.target.value); resetPage(); }}>
              <option value="">All types</option>
              {filters.data?.types.map((t) => <option key={t.type} value={t.type}>{contactTypeLabel(t.type)} ({t.count})</option>)}
            </select>
            <label className="crm-sr" htmlFor="pt-agent">Agent</label>
            <select id="pt-agent" className="crm-select" style={{ width: 'auto' }} value={agentId} onChange={(e) => { setAgentId(e.target.value); resetPage(); }}>
              <option value="">All agents</option>
              {filters.data?.agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
            </select>
          </div>

          {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

          <div className={`crm-row pt-split${selected ? ' has-sel' : ''}`}>
            <section className="crm-card grow-3 pt-list" aria-label="Partner list" style={{ padding: 0, overflow: 'hidden' }}>
              {!list.data ? <div style={{ padding: 20 }}><Skeleton h={320} /></div> : rows.length === 0 ? (
                <Empty title={tab === 'follow' ? 'No follow-ups due' : tab === 'champ' ? 'No champions yet' : tab === 'escalated' ? 'No open escalations' : 'No partners match'}>
                  {tab === 'champ' ? 'Mark a partner as champion from their profile.' : 'Try clearing a filter.'}
                </Empty>
              ) : (
                <>
                  <div className="crm-table-wrap">
                    <table className="crm-table">
                      <thead><tr><th>Partner</th><th>Priority</th><th>Next follow-up</th><th style={{ textAlign: 'right' }}>Refs 90d</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.clientId} className={`pt-tr${r.clientId === selected ? ' is-sel' : ''}`} onClick={() => go({ id: r.clientId })}>
                            <td>
                              <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 220 }}>
                                <span className="crm-initials">{initials(r.name)}</span>
                                <span style={{ minWidth: 0 }}>
                                  <button type="button" className="pt-name" onClick={(e) => { e.stopPropagation(); go({ id: r.clientId }); }}>
                                    {r.name}
                                  </button>
                                  {r.champion && <span className="pt-champ">Champion</span>}
                                  {r.escalated && <span className="pt-champ" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>Escalated</span>}
                                  <div className="crm-cell-sub">{[contactTypeLabel(r.type), [r.panchayat, r.block].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
                                  <div className="crm-cell-sub">Agent: {r.agentName}</div>
                                </span>
                              </span>
                            </td>
                            <td><Pill tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Pill></td>
                            <td style={{ whiteSpace: 'nowrap', fontWeight: r.followState === 'overdue' || r.followState === 'today' ? 700 : 500, color: followColor(r.followState) }}>{followText(r.followUpDate, r.followState)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.referrals90}{r.admitted90 > 0 && <div className="crm-cell-sub" style={{ fontWeight: 500 }}>{r.admitted90} admitted</div>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pt-pager">
                    <span>{list.data.total.toLocaleString('en-IN')} partner{list.data.total === 1 ? '' : 's'} · page {page} of {pages}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="crm-btn is-secondary is-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                      <button type="button" className="crm-btn is-secondary is-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                    </span>
                  </div>
                </>
              )}
            </section>

            <aside className="crm-card grow-2 pt-panel" aria-label="Partner profile" style={{ flexBasis: 400 }}>
              {selected ? (
                <Profile key={selected} id={selected} editable={editable} showToast={showToast}
                  onBack={() => go({ id: null })}
                  onChange={(patch) => { updateRow(selected, patch); if ('followState' in patch || 'champion' in patch || 'escalated' in patch || 'name' in patch) void list.reload(); }} />
              ) : (
                <Empty title="Pick a partner">Their notes, follow-up, survey answers and patients show here.</Empty>
              )}
            </aside>
          </div>
        </>
      )}
      {toast}
    </main>
  );
}

function Profile({ id, editable, showToast, onBack, onChange }: {
  id: string; editable: boolean; showToast: (m: string) => void; onBack: () => void; onChange: (patch: Partial<Row>) => void;
}) {
  const d = useLoader(() => crm.get<Detail>(`/api/v1/partners/${encodeURIComponent(id)}`), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState('');
  const [reply, setReply] = useState('');
  const [edit, setEdit] = useState<{ name: string; phone: string } | null>(null);

  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  const c = d.data;
  if (!c) return <Skeleton h={420} />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { showToast(friendlyError(e)); } finally { setBusy(null); }
  };

  const setPriority = (p: Priority) => run('prio', async () => {
    await crm.put(`/api/v1/partners/${encodeURIComponent(id)}/priority`, { priority: p });
    d.setData({ ...c, priority: p });
    onChange({ priority: p });
  });
  const saveFollow = (done: boolean) => run('follow', async () => {
    const res = await crm.put<{ followUpDate: string | null; followState: FollowState }>(`/api/v1/partners/${encodeURIComponent(id)}/followup`, done ? { done: true } : { date });
    setPicking(false);
    onChange({ followUpDate: res.followUpDate, followState: res.followState });
    await d.reload();
    showToast(done ? 'Follow-up marked done.' : `Follow-up set for ${fmt.date(res.followUpDate)}.`);
  });
  const toggleChampion = () => run('champ', async () => {
    await crm.put(`/api/v1/geo/contacts/${encodeURIComponent(id)}/champion`, { champion: !c.champion });
    d.setData({ ...c, champion: !c.champion });
    onChange({ champion: !c.champion });
    showToast(c.champion ? 'No longer a champion.' : `${c.name} is now a champion for ${c.panchayat ?? 'their panchayat'}.`);
  });
  const saveNote = () => run('note', async () => {
    await crm.post(`/api/v1/partners/${encodeURIComponent(id)}/notes`, { text: note });
    setNote('');
    await d.reload();
  });

  const resolve = () => run('esc', async () => {
    await crm.put(`/api/v1/admin/contacts/${encodeURIComponent(id)}`, { agentEscalationResolved: true, agentEscalationResolution: reply.trim() || 'Resolved from CRM' });
    setReply('');
    onChange({ escalated: false });
    await d.reload();
    showToast('Escalation closed. The agent sees your reply in the app.');
  });
  const saveEdit = () => run('edit', async () => {
    if (!edit) return;
    const phone = edit.phone.replace(/\D/g, '');
    if (edit.name.trim().length < 2) throw new Error('Enter the partner\'s name.');
    if (phone && phone.length !== 10) throw new Error('Phone number must be 10 digits.');
    await crm.put(`/api/v1/admin/contacts/${encodeURIComponent(id)}`, { name: edit.name.trim(), phone });
    setEdit(null);
    onChange({ name: edit.name.trim(), phone });
    await d.reload();
    showToast('Details saved.');
  });

  const waPhone = c.phone ? c.phone.replace(/\D/g, '').slice(-10) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button type="button" className="crm-btn is-secondary is-sm pt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All partners</button>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span className="crm-initials" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(c.name)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{c.name}</h2>
            {c.champion && <span className="pt-champ">Champion</span>}
          </span>
          <span className="crm-sub" style={{ fontSize: 13 }}>{[contactTypeLabel(c.type), c.profession, c.panchayat, c.block].filter(Boolean).join(' · ')}</span>
          <span className="crm-sub" style={{ fontSize: 13 }}>{c.phone ?? 'No phone'}{c.phoneInvalid ? ' (marked wrong number)' : ''} · added by {c.agentName} on {fmt.date(c.createdAt)}</span>
        </span>
      </div>

      {c.escalation && !c.escalation.resolved && (
        <div className="crm-note" style={{ background: 'var(--bad-soft)', color: 'var(--bad)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>Escalated by {c.agentName}</strong>
          <span style={{ color: 'var(--text)', fontSize: 14 }}>{c.escalation.note || 'No note given.'}</span>
          {editable && (
            <>
              <label className="crm-sr" htmlFor="esc-reply">Reply to the agent</label>
              <textarea id="esc-reply" className="crm-textarea" rows={2} style={{ minHeight: 60 }} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="What was done? The agent sees this." />
              <button type="button" className="crm-btn is-sm" style={{ alignSelf: 'flex-end' }} disabled={busy === 'esc'} onClick={resolve}>Close escalation</button>
            </>
          )}
        </div>
      )}
      {c.escalation?.resolved && c.escalation.resolution && (
        <div className="crm-note">Escalation closed: {c.escalation.resolution}</div>
      )}

      <div className="crm-chips">
        {c.phone && <a href={`tel:${c.phone}`} className="crm-btn is-ok" style={{ color: '#fff' }}><Phone size={16} aria-hidden /> Call</a>}
        {waPhone.length === 10 && !c.whatsappOptOut && <a href={`https://wa.me/91${waPhone}`} target="_blank" rel="noreferrer" className="crm-btn is-secondary"><MessageCircle size={16} aria-hidden /> WhatsApp</a>}
        {editable && (
          <button type="button" className="crm-btn is-secondary" aria-pressed={c.champion} disabled={busy === 'champ'} onClick={toggleChampion}>
            <Star size={16} aria-hidden fill={c.champion ? 'currentColor' : 'none'} /> {c.champion ? 'Champion' : 'Mark as champion'}
          </button>
        )}
        {editable && <button type="button" className="crm-btn is-secondary" onClick={() => setEdit({ name: c.name, phone: c.phone ?? '' })}>Edit details</button>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }} id="prio-l">Priority</span>
        <div className="pt-prio" role="radiogroup" aria-labelledby="prio-l">
          {PRIORITY_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={c.priority === k} data-tone={PRIORITY[k].tone}
              disabled={!editable || busy === 'prio'} onClick={() => c.priority !== k && setPriority(k)}>{PRIORITY[k].label}</button>
          ))}
        </div>
      </div>

      <div className="pt-follow" data-state={c.followState}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 150px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Next follow-up</span>
          <strong style={{ fontSize: 15, color: followColor(c.followState) }}>
            {c.followState === 'none' ? 'Not set' : `${fmt.date(c.followUpDate)}${c.followState === 'overdue' ? ' · overdue' : c.followState === 'today' ? ' · today' : ''}`}
          </strong>
        </span>
        {editable && !picking && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => { setDate(c.followUpDate ? new Date(new Date(c.followUpDate).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) : istToday()); setPicking(true); }}>
              {c.followState === 'none' ? 'Set date' : 'Change date'}
            </button>
            {c.followState !== 'none' && <button type="button" className="crm-btn is-ok is-sm" disabled={busy === 'follow'} onClick={() => saveFollow(true)}>Mark done</button>}
          </span>
        )}
        {picking && (
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="crm-sr" htmlFor="fu-date">Follow-up date</label>
            <input id="fu-date" type="date" className="crm-input" style={{ width: 170, height: 38 }} min={istToday()} value={date} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className="crm-btn is-sm" disabled={!date || busy === 'follow'} onClick={() => saveFollow(false)}>Save</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPicking(false)}>Cancel</button>
          </span>
        )}
      </div>

      <div className="pt-stats">
        <span><span>Referrals 90d</span><strong>{c.stats.referrals90}</strong></span>
        <span><span>Admitted 90d</span><strong>{c.stats.admitted90}</strong></span>
        <span><span>Last visit</span><strong style={{ fontSize: 15 }}>{c.lastVisit ? fmt.date(c.lastVisit) : '—'}</strong></span>
      </div>

      <section aria-labelledby="notes-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h3 id="notes-h" style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Notes &amp; history</h3>
          <span className="crm-cell-sub">from the app and the call desk</span>
        </span>
        {editable && (
          <>
            <label className="crm-sr" htmlFor="pt-note">Add a note</label>
            <textarea id="pt-note" className="crm-textarea" rows={2} style={{ minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team… The field agent sees it in the app." />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="crm-btn is-sm" disabled={!note.trim() || busy === 'note'} onClick={saveNote}>Save note</button>
            </div>
          </>
        )}
        {c.timeline.length === 0 ? <span className="crm-cell-sub">Nothing yet.</span> : (
          <ul className="crm-list">
            {c.timeline.map((t, i) => {
              const m = KIND_META[t.kind];
              return (
                <li key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                  <span aria-hidden style={{ width: 30, height: 30, borderRadius: 999, background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{m.letter}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.text}</span>
                    <span className="crm-cell-sub">{m.label} · {t.by} · {fmt.dateTime(t.at)}{t.kind === 'note' || t.kind === 'visit' ? (t.fromApp ? ' · from app' : ' · from CRM') : ''}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="sv-h" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 id="sv-h" style={{ fontSize: 16, fontWeight: 800 }}>Survey answers</h3>
        {!c.survey.done ? (
          <span className="crm-cell-sub">{c.survey.skipped ? 'The agent skipped the survey for this partner.' : 'No survey yet.'}</span>
        ) : (
          <>
            {c.survey.answers.map((a) => (
              <div key={a.question} className="pt-sv"><span>{a.question}</span><strong>{a.answer}</strong></div>
            ))}
            <span className="crm-cell-sub">Answered {fmt.date(c.survey.at)}</span>
          </>
        )}
      </section>

      <section aria-labelledby="rf-h" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 id="rf-h" style={{ fontSize: 16, fontWeight: 800 }}>Patients sent ({c.stats.referralsAll})</h3>
        {c.referrals.length === 0 ? <span className="crm-cell-sub">No patients yet.</span> : (
          <ul className="crm-list">
            {c.referrals.map((r) => (
              <li key={r.clientId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 600, fontSize: 14 }}>{r.patientName}</span><div className="crm-cell-sub">{[r.department, fmt.date(r.createdAt)].filter(Boolean).join(' · ')}</div></span>
                <Pill tone={r.status === 'admitted' || r.status === 'discharged' || r.status === 'procedure' ? 'ok' : r.status === 'lost' || r.status === 'cancelled' ? 'bad' : 'neutral'}>{r.label}</Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit && (
        <Modal title="Edit partner" onClose={() => setEdit(null)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="crm-btn" disabled={busy === 'edit'} onClick={saveEdit}>Save</button>
        </>}>
          <label className="crm-field">Name
            <input className="crm-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label className="crm-field">Phone
            <input className="crm-input" inputMode="numeric" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="10-digit mobile number" />
          </label>
        </Modal>
      )}
    </div>
  );
}

function Duplicates({ data, error, reload, editable, showToast }: {
  data: DupRes | null | undefined; error: string | null; reload: () => void; editable: boolean; showToast: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: 'merge' | 'dismiss') => {
    setBusy(id);
    try {
      await crm.post(`/api/v1/duplicates/${encodeURIComponent(id)}/${action}`);
      showToast(action === 'merge' ? 'Merged. The second record is hidden from lists.' : 'Kept as two different people.');
      reload();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Skeleton h={240} />;
  if (data.items.length === 0) return <section className="crm-card"><Empty title="No possible duplicates">When an agent adds someone with the same phone or a very similar name, they show up here.</Empty></section>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="crm-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>
        These records share a phone number or a very similar name. Merging keeps the first record; the second is hidden from lists and calls.
      </div>
      {data.items.map((p) => {
        const inBatch = p.recordA.clientId === 'in_batch_duplicate';
        const samePhone = !!p.recordA.phone && p.recordA.phone === p.recordB.phone;
        return (
          <section key={p.id} className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong style={{ flex: 1 }}>{inBatch ? 'Added twice in one sync' : samePhone ? 'Same phone number' : 'Similar name'}</strong>
              <span className="crm-cell-sub">Found {fmt.date(p.recordB.createdAt)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {(inBatch ? [p.recordB] : [p.recordA, p.recordB]).map((r, i) => (
                <div key={r.clientId + i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span className="crm-cell-sub" style={{ fontWeight: 600 }}>{i === 0 && !inBatch ? 'Keep' : 'Possible copy'}</span>
                  <strong style={{ fontSize: 15 }}>{r.name}</strong>
                  <span className="crm-sub" style={{ fontSize: 13 }}>{contactTypeLabel(r.role)} · {r.phone ?? 'No phone'}</span>
                  <span className="crm-sub" style={{ fontSize: 13 }}>{r.panchayatName} · by {r.agentName} · {fmt.date(r.createdAt)}</span>
                </div>
              ))}
            </div>
            {editable && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="crm-btn is-secondary" disabled={busy === p.id} onClick={() => act(p.id, 'dismiss')}>Not the same person</button>
                <button type="button" className="crm-btn" disabled={busy === p.id} onClick={() => act(p.id, 'merge')}>Merge into first</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
