'use client';

import { Fragment, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, History, Laptop, LogIn, LogOut, Minus, Pencil, Plus, RotateCcw, Search, Smartphone, Tablet, UserX, KeyRound } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, fmt, initials, Modal, PageHead, Pill, Skeleton, useLoader, type Tone } from '@/components/crm/ui';

type Change = { from: unknown; to: unknown };
interface AuditRow {
  id: string; at: string; actorId: string; actorName?: string | null; actorRole?: string | null; source: string;
  deviceType?: string | null; deviceId?: string | null; ip?: string | null; request?: string | null;
  action: string; entity: string; entityId?: string | null; summary?: string | null;
  changes?: Record<string, Change> | null;
}
interface Page { total: number; page: number; size: number; items: AuditRow[] }
interface Filters { actors: { id: string; name: string; count: number }[]; entities: { name: string; count: number }[] }

const ACTIONS: Record<string, { label: string; tone: Tone; icon: typeof Plus }> = {
  create: { label: 'Added', tone: 'ok', icon: Plus },
  update: { label: 'Changed', tone: 'info', icon: Pencil },
  delete: { label: 'Removed', tone: 'bad', icon: Minus },
  sign_in: { label: 'Signed in', tone: 'neutral', icon: LogIn },
  sign_out: { label: 'Signed out', tone: 'neutral', icon: LogOut },
  session_replaced: { label: 'Session ended', tone: 'warn', icon: UserX },
  password_reset: { label: 'Password reset', tone: 'warn', icon: KeyRound },
};
const DEVICES: Record<string, { label: string; icon: typeof Laptop }> = {
  desktop: { label: 'Laptop', icon: Laptop }, tablet: { label: 'Tablet', icon: Tablet }, phone: { label: 'Phone', icon: Smartphone },
};

const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => istDay(new Date(Date.now() - n * 86400e3).toISOString());
const dayHead = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "PatientName" → "Patient name", "ContactClientId" → "Contact client id". */
function fieldLabel(k: string) {
  const s = k.replace(/Json$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt.dateTime(v);
  return String(v);
}

function ChangeTable({ row }: { row: AuditRow }) {
  const entries = Object.entries(row.changes ?? {});
  if (entries.length === 0) return <p className="crm-sub" style={{ margin: 0 }}>No field details for this event.</p>;
  const isNew = row.action === 'create', isGone = row.action === 'delete';
  return (
    <table className="crm-table au-diff">
      <thead><tr><th>Field</th>{!isNew && <th>Before</th>}{!isGone && <th>{isNew ? 'Value' : 'After'}</th>}</tr></thead>
      <tbody>
        {entries.map(([k, c]) => (
          <tr key={k}>
            <td>{fieldLabel(k)}</td>
            {!isNew && <td className="au-from">{show(c.from)}</td>}
            {!isGone && <td className="au-to">{show(c.to)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Who({ row }: { row: AuditRow }) {
  const D = DEVICES[row.deviceType ?? ''];
  return (
    <span className="au-who">
      <span className="crm-avatar is-sm" aria-hidden>{row.actorId === 'system' ? 'S' : initials(row.actorName ?? row.actorId)}</span>
      <span style={{ minWidth: 0 }}>
        <strong>{row.actorName ?? row.actorId}</strong>
        <span className="crm-cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {row.actorId !== 'system' && <span>{row.actorId}</span>}
          {D && <span className="au-dev" title={D.label}><D.icon size={12} aria-hidden /> {D.label}</span>}
          <span>{D ? '· ' : ''}{row.source === 'app' ? 'App' : row.source === 'crm' ? 'CRM' : 'Automatic'}</span>
        </span>
      </span>
    </span>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <AuditLog />
    </Suspense>
  );
}

function AuditLog() {
  const params = useSearchParams();
  // Opened from Users & roles ("Activity") or another page: start on that person or record, over the last 30 days.
  const linked = !!(params.get('actor') || params.get('entityId'));
  const [actor, setActor] = useState(() => params.get('actor') ?? '');
  const [entity, setEntity] = useState(() => params.get('entity') ?? '');
  const [entityId, setEntityId] = useState(() => params.get('entityId') ?? '');
  const [action, setAction] = useState('');
  const [device, setDevice] = useState('');
  const [from, setFrom] = useState(() => daysAgo(linked ? 29 : 6));
  const [to, setTo] = useState(() => daysAgo(0));
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [record, setRecord] = useState<AuditRow | null>(null);

  const filters = useLoader(() => crm.get<Filters>('/api/v1/audit/filters'), []);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (actor) p.set('actor', actor);
    if (entity) p.set('entity', entity);
    if (entityId) p.set('entityId', entityId);
    if (action) p.set('action', action);
    if (device) p.set('device', device);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (term) p.set('q', term);
    return p.toString();
  }, [actor, entity, entityId, action, device, from, to, term]);
  const list = useLoader(async () => {
    const all: AuditRow[] = [];
    let total = 0;
    for (let i = 1; i <= pages; i++) {
      const r = await crm.get<Page>(`/api/v1/audit?${qs}&page=${i}&size=100`);
      all.push(...r.items); total = r.total;
      if (r.items.length < 100) break;
    }
    return { total, items: all };
  }, [qs, pages]);

  const history = useLoader(
    () => (record?.entityId ? crm.get<AuditRow[]>(`/api/v1/audit/record?entity=${encodeURIComponent(record.entity)}&id=${encodeURIComponent(record.entityId)}`) : Promise.resolve([])),
    [record?.entity, record?.entityId],
  );

  const reset = () => { setActor(''); setEntity(''); setEntityId(''); setAction(''); setDevice(''); setFrom(daysAgo(6)); setTo(daysAgo(0)); setQ(''); setTerm(''); setPages(1); };
  const range = (n: number) => { setFrom(daysAgo(n)); setTo(daysAgo(0)); setPages(1); };

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const groups = useMemo(() => {
    const g: { day: string; rows: AuditRow[] }[] = [];
    for (const r of rows) {
      const d = istDay(r.at);
      if (g.length === 0 || g[g.length - 1].day !== d) g.push({ day: d, rows: [] });
      g[g.length - 1].rows.push(r);
    }
    return g;
  }, [rows]);

  return (
    <main className="crm-page">
      <PageHead title="Activity log" sub="Every record added, changed or removed, and every sign-in: who did it, when, from which device, and what changed. Passwords are never shown." />

      <section className="crm-card au-filters" aria-label="Filters">
        <form className="au-search" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setPages(1); }}>
          <Search size={16} aria-hidden />
          <label className="crm-sr" htmlFor="au-q">Search</label>
          <input id="au-q" className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, patient, partner, ID or value…" />
          <button type="submit" className="crm-btn is-sm">Search</button>
        </form>
        <div className="au-row">
          <label className="crm-field">Person
            <select className="crm-select" value={actor} onChange={(e) => { setActor(e.target.value); setPages(1); }}>
              <option value="">Everyone</option>
              {(filters.data?.actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.id !== 'system' ? ` (${a.id})` : ''}</option>)}
            </select>
          </label>
          <label className="crm-field">Record
            <select className="crm-select" value={entity} onChange={(e) => { setEntity(e.target.value); setPages(1); }}>
              <option value="">All records</option>
              {(filters.data?.entities ?? []).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select>
          </label>
          <label className="crm-field">What happened
            <select className="crm-select" value={action} onChange={(e) => { setAction(e.target.value); setPages(1); }}>
              <option value="">Anything</option>
              {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="crm-field">Device
            <select className="crm-select" value={device} onChange={(e) => { setDevice(e.target.value); setPages(1); }}>
              <option value="">Any device</option>
              {Object.entries(DEVICES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="crm-field">From
            <input type="date" className="crm-input" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPages(1); }} />
          </label>
          <label className="crm-field">To
            <input type="date" className="crm-input" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPages(1); }} />
          </label>
        </div>
        <div className="crm-chips" style={{ alignItems: 'center' }}>
          <button type="button" className="crm-chip" aria-pressed={from === daysAgo(0) && to === daysAgo(0)} onClick={() => range(0)}>Today</button>
          <button type="button" className="crm-chip" aria-pressed={from === daysAgo(6) && to === daysAgo(0)} onClick={() => range(6)}>Last 7 days</button>
          <button type="button" className="crm-chip" aria-pressed={from === daysAgo(29) && to === daysAgo(0)} onClick={() => range(29)}>Last 30 days</button>
          {entityId && (
            <button type="button" className="crm-chip" aria-pressed onClick={() => { setEntityId(''); setPages(1); }} title="Show all records again">
              One record: {entityId.length > 14 ? `${entityId.slice(0, 12)}…` : entityId} ✕
            </button>
          )}
          <span style={{ flex: 1 }} />
          {list.data && <span className="crm-sub" style={{ fontSize: 13 }}>{list.data.total.toLocaleString('en-IN')} event{list.data.total === 1 ? '' : 's'}</span>}
          <button type="button" className="crm-btn is-secondary is-sm" onClick={reset}><RotateCcw size={14} aria-hidden /> Clear filters</button>
        </div>
      </section>

      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : list.loading && !list.data ? (
        <div className="crm-card" style={{ display: 'grid', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={44} />)}</div>
      ) : rows.length === 0 ? (
        <Empty title="Nothing in this range">Try a longer date range or clear the filters. Changes are recorded from the day this log was switched on.</Empty>
      ) : (
        <section className="crm-card" style={{ padding: 0 }}>
          <div className="crm-table-wrap">
            <table className="crm-table au-table">
              <thead><tr><th style={{ width: 28 }} aria-label="Details" /><th>Time</th><th>Who</th><th>What happened</th><th>Record</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.day}>
                    <tr className="au-day"><td colSpan={5}>{dayHead.format(new Date(`${g.day}T00:00:00Z`))}</td></tr>
                    {g.rows.map((r) => {
                      const A = ACTIONS[r.action] ?? { label: r.action, tone: 'neutral' as Tone, icon: Pencil };
                      const n = Object.keys(r.changes ?? {}).length;
                      const isOpen = open === r.id;
                      return (
                        <Fragment key={r.id}>
                          <tr className="au-item" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                            <td>{isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</td>
                            <td style={{ whiteSpace: 'nowrap' }}><strong>{fmt.time(r.at)}</strong></td>
                            <td><Who row={r} /></td>
                            <td>
                              <Pill tone={A.tone}><A.icon size={12} aria-hidden /> {A.label}</Pill>
                              {r.action === 'update' && n > 0 && (
                                <div className="crm-cell-sub">{Object.keys(r.changes ?? {}).slice(0, 3).map(fieldLabel).join(', ')}{n > 3 ? ` +${n - 3} more` : ''}</div>
                              )}
                            </td>
                            <td>
                              <strong>{r.entity}</strong>{r.summary ? <span> · {r.summary}</span> : null}
                              {r.entityId && <div className="crm-cell-sub au-id">{r.entityId}</div>}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="au-detail">
                              <td />
                              <td colSpan={4}>
                                <ChangeTable row={r} />
                                <div className="au-meta">
                                  <span>{fmt.dateTime(r.at)}</span>
                                  {r.ip && <span>IP {r.ip}</span>}
                                  {r.deviceId && <span>Device {r.deviceId.slice(0, 8)}</span>}
                                  {r.request && <span className="au-id">{r.request}</span>}
                                  {r.entityId && r.entity !== 'Sign-in' && (
                                    <button type="button" className="crm-btn is-secondary is-sm" onClick={(e) => { e.stopPropagation(); setRecord(r); }}>
                                      <History size={14} aria-hidden /> Full history of this record
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {list.data && rows.length < list.data.total && (
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="crm-btn is-secondary" disabled={list.loading} onClick={() => setPages((p) => p + 1)}>
                {list.loading ? 'Loading…' : `Show more (${(list.data.total - rows.length).toLocaleString('en-IN')} older)`}
              </button>
            </div>
          )}
        </section>
      )}

      {record && (
        <Modal wide title={`${record.entity}${record.summary ? ` · ${record.summary}` : ''}`} onClose={() => setRecord(null)}>
          {history.loading && !history.data ? <Skeleton h={120} /> : history.error ? <ErrorBox message={history.error} /> : (
            <ol className="au-timeline">
              {(history.data ?? []).map((h) => {
                const A = ACTIONS[h.action] ?? { label: h.action, tone: 'neutral' as Tone, icon: Pencil };
                return (
                  <li key={h.id}>
                    <div className="au-tl-head">
                      <Pill tone={A.tone}><A.icon size={12} aria-hidden /> {A.label}</Pill>
                      <span className="crm-sub">{fmt.dateTime(h.at)}</span>
                    </div>
                    <Who row={h} />
                    <ChangeTable row={h} />
                  </li>
                );
              })}
            </ol>
          )}
        </Modal>
      )}
    </main>
  );
}
