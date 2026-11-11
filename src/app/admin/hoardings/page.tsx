'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Camera, Pencil, Plus, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, Pill, rupees, Skeleton, useToast } from '@/components/crm/ui';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { HoardingDrawer } from '@/components/crm/hoardings/HoardingDrawer';
import { PlaceForm } from '@/components/crm/hoardings/PlaceForm';
import { dayText, kindLabel, leftText, REJECTED_COLOR, stageOf, STAGES, type Hoarding, type HoardingData, type HoardingOwner } from '@/lib/crm/hoardings';

const HoardingMap = dynamic(() => import('@/components/crm/hoardings/HoardingMap'), { ssr: false, loading: () => <Skeleton h={440} /> });

export default function HoardingsWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <HoardingsPage />
    </Suspense>
  );
}

const TABS = ['board', 'owners'] as const;

/**
 * Banner and hoarding places: agents suggest them from the app with a photo and GPS, the office approves them with the
 * rent, and each one moves along the board until the rental ends. The rent is filled in and seen only here.
 */
function HoardingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const editable = canEdit(access, 'hoardings');
  const [tab, setTab] = usePageTab(TABS, 'board');
  const [data, setData] = useState<HoardingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState('');
  const [showRejected, setShowRejected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Hoarding | null>(null);
  const [ownerEdit, setOwnerEdit] = useState<HoardingOwner | 'new' | null>(null);
  const [toast, showToast] = useToast();
  const openId = params.get('id');

  const load = useCallback(async () => {
    try { setData(await crm.get<HoardingData>('/api/v1/hoardings')); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const open = useCallback((id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set('id', id); else p.delete('id');
    const s = p.toString();
    router.replace(`/admin/hoardings${s ? `?${s}` : ''}`, { scroll: false });
  }, [params, router]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const owners = useMemo(() => data?.owners ?? [], [data]);
  const ownerName = useMemo(() => new Map(owners.map((o) => [o.id, o.name])), [owners]);
  const agents = useMemo(() => [...new Map(items.filter((h) => h.fromAgent).map((h) => [h.suggestedBy, h.suggestedByName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((h) => (!agent || h.suggestedBy === agent)
      && (!needle || [h.place, h.landmark, h.block, h.district, h.suggestedByName, h.ownerId ? ownerName.get(h.ownerId) : ''].some((x) => (x ?? '').toLowerCase().includes(needle))));
  }, [items, q, agent, ownerName]);
  const rejected = shown.filter((h) => h.status === 'rejected');
  const onMap = shown.filter((h) => showRejected || h.status !== 'rejected');
  const pins = useMemo(() => onMap.map((h) => ({
    id: h.id, lat: h.lat, lng: h.lng, color: h.status === 'rejected' ? REJECTED_COLOR : stageOf(h.stage).color,
    title: `${h.place} · ${stageOf(h.stage).label}`, faded: h.status === 'ended' || h.status === 'rejected',
  })), [onMap]);
  const current = openId ? items.find((h) => h.id === openId) ?? null : null;

  const merge = (h: Hoarding) => {
    setData((d) => d ? { ...d, items: d.items.some((x) => x.id === h.id) ? d.items.map((x) => x.id === h.id ? h : x) : [h, ...d.items] } : d);
    void load(); // the money summary and owner totals come from the server
  };

  const s = data?.summary;
  return (
    <main className="crm-page">
      <PageHead title="Hoardings" sub="Banner places your agents find, the ones you approved and rented, and what they cost each month. Agents add places from the app; the rent is filled in and seen only here.">
        {editable && <button type="button" className="crm-btn" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add a place</button>}
      </PageHead>

      {error && !data ? <ErrorBox message={error} onRetry={load} /> : !data || !s ? <Skeleton h={520} /> : (
        <>
          <div className="crm-kpis hd-kpis">
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Rent every month</span><span className="crm-kpi-value">{rupees(s.monthlySpend)}</span><span className="crm-sub">{s.running} {s.running === 1 ? 'place' : 'places'} rented now</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Waiting for your answer</span><span className="crm-kpi-value">{s.waiting}</span><span className="crm-sub">suggested by agents</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Ending within {data.endingDays} days</span><span className="crm-kpi-value" style={s.endingSoon > 0 ? { color: 'var(--bad)' } : undefined}>{s.endingSoon}</span><span className="crm-sub">renew or end them</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Rent not filled in</span><span className="crm-kpi-value" style={s.rentMissing > 0 ? { color: 'var(--warn-ink)' } : undefined}>{s.rentMissing}</span><span className="crm-sub">{s.approvedRent > 0 ? `${rupees(s.approvedRent)} a month more once approved places are rented` : 'approved or rented places'}</span></div>
          </div>

          <PageTabs label="Hoardings" value={tab} onChange={setTab} tabs={[{ key: 'board', label: 'Map and board' }, { key: 'owners', label: 'Owners', count: owners.length }]} />

          {tab === 'board' ? (
            <>
              <div className="hd-filters">
                <label className="crm-search"><Search size={16} aria-hidden /><input value={q} placeholder="Search place, owner, agent or block" aria-label="Search hoardings" onChange={(e) => setQ(e.target.value)} /></label>
                {agents.length > 1 && (
                  <select className="crm-select hd-agent" value={agent} aria-label="Agent" onChange={(e) => setAgent(e.target.value)}>
                    <option value="">All agents</option>
                    {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                )}
                {rejected.length > 0 && <button type="button" className="crm-chip" aria-pressed={showRejected} onClick={() => setShowRejected((v) => !v)}>Not taken ({rejected.length})</button>}
              </div>

              {items.length === 0 ? (
                <section className="crm-card"><Empty title="No hoarding places yet">
                  <span className="crm-sub">Agents add them from the app: + → Hoarding place, with a photo. You can also add one here.</span>
                  {editable && <button type="button" className="crm-btn is-sm" onClick={() => setAdding(true)}>Add a place</button>}
                </Empty></section>
              ) : (
                <>
                  <section className="crm-card hd-map-card">
                    <HoardingMap pins={pins} selected={openId} onSelect={(id) => open(id)} fitKey={`${pins.length}|${agent}|${q}`} height={440} />
                    <div className="hd-legend">
                      {STAGES.map((st) => <span key={st.key}><i style={{ background: st.color }} />{st.label}</span>)}
                    </div>
                  </section>

                  <div className="hd-board" style={{ ['--cols' as string]: STAGES.length + (showRejected ? 1 : 0) }}>
                    {STAGES.map((st) => {
                      const rows = shown.filter((h) => h.stage === st.key && h.status !== 'rejected')
                        .sort((a, b) => st.key === 'ending' ? (a.daysLeft ?? 0) - (b.daysLeft ?? 0) : b.updatedAt.localeCompare(a.updatedAt));
                      const sum = rows.reduce((n, h) => n + (h.monthlyRent ?? 0), 0);
                      return (
                        <section key={st.key} className="hd-col" aria-label={st.label}>
                          <header className="hd-col-h"><i style={{ background: st.color }} /><strong>{st.label}</strong><span className="hd-col-n">{rows.length}</span>{sum > 0 && <span className="hd-col-sum">{rupees(sum)}/mo</span>}</header>
                          <p className="hd-col-hint">{st.hint}</p>
                          <div className="hd-col-body">
                            {rows.map((h) => <Card key={h.id} h={h} owner={h.ownerId ? ownerName.get(h.ownerId) : undefined} on={h.id === openId} onOpen={() => open(h.id)} />)}
                            {rows.length === 0 && <span className="hd-col-empty">Nothing here</span>}
                          </div>
                        </section>
                      );
                    })}
                    {showRejected && (
                      <section className="hd-col" aria-label="Not taken">
                        <header className="hd-col-h"><i style={{ background: REJECTED_COLOR }} /><strong>Not taken</strong><span className="hd-col-n">{rejected.length}</span></header>
                        <p className="hd-col-hint">Kept, so the same place isn’t suggested again.</p>
                        <div className="hd-col-body">{rejected.map((h) => <Card key={h.id} h={h} on={h.id === openId} onOpen={() => open(h.id)} />)}</div>
                      </section>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <section className="crm-card">
              <div className="crm-card-head">
                <h2 className="crm-h2" style={{ marginRight: 'auto' }}>Who you rent from</h2>
                {editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setOwnerEdit('new')}><Plus size={14} aria-hidden /> Add owner</button>}
              </div>
              {owners.length === 0 ? <Empty title="No owners yet"><span className="crm-sub">Pick or add the owner when you open a place. One owner can have several places.</span></Empty> : (
                <div className="crm-table-wrap">
                  <table className="crm-table">
                    <thead><tr><th scope="col">Owner</th><th scope="col">Phone</th><th scope="col">Places</th><th scope="col" className="wb-num">Rent every month</th><th scope="col">Notes</th><th scope="col" /></tr></thead>
                    <tbody>
                      {owners.map((o) => {
                        const theirs = items.filter((h) => h.ownerId === o.id && h.status !== 'rejected');
                        return (
                          <tr key={o.id}>
                            <td><strong>{o.name}</strong>{o.address && <div className="crm-cell-sub">{o.address}</div>}</td>
                            <td>{o.phone ? <a className="wa-link" href={`tel:${o.phone}`}>{o.phone}</a> : '—'}</td>
                            <td>
                              <div className="hd-owner-places">
                                {theirs.map((h) => <button key={h.id} type="button" className="hd-owner-place" onClick={() => router.replace(`/admin/hoardings?id=${h.id}`, { scroll: false })}><i style={{ background: stageOf(h.stage).color }} />{h.place}</button>)}
                                {theirs.length === 0 && <span className="crm-sub">None yet</span>}
                              </div>
                            </td>
                            <td className="wb-num">{o.monthlyRent > 0 ? rupees(o.monthlyRent) : '—'}<div className="crm-cell-sub">{o.running} rented now</div></td>
                            <td className="fs-note">{o.notes ?? ''}</td>
                            <td>{editable && <button type="button" className="crm-btn is-ghost is-sm" aria-label={`Edit ${o.name}`} onClick={() => setOwnerEdit(o)}><Pencil size={14} aria-hidden /></button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {current && data && !editing && (
        <HoardingDrawer key={`${current.id}|${current.updatedAt}`} row={current} owners={owners} all={items} today={data.today} editable={editable}
          onClose={() => open(null)} onChanged={merge} onEdit={() => setEditing(current)} onOpen={(id) => open(id)} toast={showToast} />
      )}
      {(adding || editing) && data && (
        <PlaceForm row={editing} kinds={data.kinds} onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(h) => { const fresh = !editing; setAdding(false); setEditing(null); merge(h); showToast(fresh ? 'Place added. Fill in the rent and the owner.' : 'Saved'); if (fresh) open(h.id); }} />
      )}
      {ownerEdit && <OwnerForm owner={ownerEdit === 'new' ? null : ownerEdit} onClose={() => setOwnerEdit(null)} onSaved={() => { setOwnerEdit(null); showToast('Saved'); void load(); }} />}
      {toast}
    </main>
  );
}

function Card({ h, owner, on, onOpen }: { h: Hoarding; owner?: string; on: boolean; onOpen: () => void }) {
  const running = h.status === 'rented' || h.status === 'live';
  return (
    <button type="button" className={`hd-card${on ? ' is-on' : ''}`} onClick={onOpen}>
      <span className="hd-card-t">{h.place}</span>
      <span className="hd-card-s">{[kindLabel(h.kind), h.size, h.block].filter(Boolean).join(' · ')}</span>
      {h.status === 'rejected' ? <span className="hd-card-s">{h.rejectReason}</span> : (
        <span className="hd-card-money">
          {h.monthlyRent != null ? <strong>{rupees(h.monthlyRent)}<small>/mo</small></strong> : h.rentMissing ? <Pill tone="warn">Rent not filled in</Pill> : <span className="hd-card-s">No rent yet</span>}
          {running && h.rentEnd && <span className={h.stage === 'ending' ? 'hd-card-end is-soon' : 'hd-card-end'}>{h.stage === 'ending' ? leftText(h.daysLeft) : `until ${dayText(h.rentEnd)}`}</span>}
        </span>
      )}
      <span className="hd-card-foot">
        <span className="hd-card-by">{h.suggestedByName}</span>
        {owner && <span className="hd-card-owner">{owner}</span>}
        {h.photos.length > 0 && <span className="hd-card-ph" aria-label={`${h.photos.length} photos`}><Camera size={12} aria-hidden />{h.photos.length}</span>}
      </span>
    </button>
  );
}

function OwnerForm({ owner, onClose, onSaved }: { owner: HoardingOwner | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(owner?.name ?? '');
  const [phone, setPhone] = useState(owner?.phone ?? '');
  const [address, setAddress] = useState(owner?.address ?? '');
  const [notes, setNotes] = useState(owner?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setErr("Write the owner's name."); return; }
    setBusy(true); setErr(null);
    try {
      if (owner) await crm.put(`/api/v1/hoardings/owners/${owner.id}`, { name, phone, address, notes });
      else await crm.post('/api/v1/hoardings/owners', { name, phone, address, notes });
      onSaved();
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title={owner ? 'Edit owner' : 'Add owner'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <label className="crm-field">Name<input className="crm-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <label className="crm-field">Phone<input className="crm-input" inputMode="tel" value={phone} maxLength={14} placeholder="10 digits" onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="crm-field">Address<input className="crm-input" value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} /></label>
      <label className="crm-field">Notes<textarea className="crm-textarea" value={notes} maxLength={1000} placeholder="e.g. Pay by the 5th, by UPI" onChange={(e) => setNotes(e.target.value)} /></label>
      {err && <div className="crm-error" role="alert">{err}</div>}
    </Modal>
  );
}
