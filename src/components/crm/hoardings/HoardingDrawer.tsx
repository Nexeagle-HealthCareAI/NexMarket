'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ExternalLink, MapPin, Pencil, Upload, User, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { fmt, friendlyError, Pill, rupees } from '@/components/crm/ui';
import { dayText, kindLabel, leftText, stageOf, type Hoarding, type HoardingOwner, type HoardingStatus } from '@/lib/crm/hoardings';

const STEPS: { key: HoardingStatus; label: string }[] = [
  { key: 'suggested', label: 'Suggested' }, { key: 'approved', label: 'Approved' }, { key: 'rented', label: 'Rented' }, { key: 'live', label: 'Banner up' }, { key: 'ended', label: 'Ended' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addMonths(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() !== day) d.setDate(0); // 31 Jan + 1 month → the last day of February
  return iso(d);
}

function Photo({ id, kind }: { id: string; kind: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true, made: string | null = null;
    crm.blob(`/api/v1/hoardings/photos/${id}`).then((b) => { made = URL.createObjectURL(b); if (live) setUrl(made); }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  const label = kind === 'banner' ? 'Banner up' : 'The place';
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="hd-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a private blob URL */}
      <img src={url} alt={kind === 'banner' ? 'The banner in place' : 'The place before the banner'} />
      <span>{label}</span>
    </a>
  ) : <div className="hd-photo is-loading"><Camera size={18} aria-hidden /><span>{label}</span></div>;
}

/**
 * Everything about one banner place: where it is on the way from "suggested" to "ended", its photos, its owner, and
 * (office only) the rent and dates. The next step is one button.
 */
export function HoardingDrawer({ row, owners, all, today, editable, onClose, onChanged, onEdit, onOpen, toast }: {
  row: Hoarding; owners: HoardingOwner[]; all: Hoarding[]; today: string; editable: boolean;
  onClose: () => void; onChanged: (h: Hoarding) => void; onEdit: () => void; onOpen: (id: string) => void; toast: (m: string) => void;
}) {
  const [rent, setRent] = useState(row.monthlyRent != null ? String(row.monthlyRent) : '');
  const [start, setStart] = useState(row.rentStart ?? '');
  const [end, setEnd] = useState(row.rentEnd ?? '');
  const [ownerId, setOwnerId] = useState(row.ownerId ?? '');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [note, setNote] = useState(row.officeNote ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoKind = useRef<'site' | 'banner'>('site');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = stageOf(row.stage);
  const owner = owners.find((o) => o.id === row.ownerId);
  const siblings = row.ownerId ? all.filter((h) => h.ownerId === row.ownerId && h.id !== row.id && h.status !== 'rejected') : [];
  const stepAt = STEPS.findIndex((s) => s.key === row.status);
  const dirty = rent !== (row.monthlyRent != null ? String(row.monthlyRent) : '') || start !== (row.rentStart ?? '') || end !== (row.rentEnd ?? '')
    || ownerId !== (row.ownerId ?? '') || note !== (row.officeNote ?? '');

  const body = () => ({
    setRent: true, monthlyRent: rent.trim() === '' ? null : Number(rent), rentStart: start, rentEnd: end,
    setOwner: true, ownerId: ownerId && ownerId !== 'new' ? ownerId : null, ownerName: ownerId === 'new' ? ownerName : null, ownerPhone: ownerId === 'new' ? ownerPhone : null,
    note,
  });
  const check = (): string | null => {
    if (rent.trim() !== '' && !(Number(rent) >= 0)) return 'The rent should be a number.';
    if (ownerId === 'new' && !ownerName.trim()) return "Write the owner's name.";
    return null;
  };

  /** Saves the rent and owner (when changed), then moves the place to the next step. */
  const run = async (to: HoardingStatus | null, done: string, extra?: { reason?: string }) => {
    const bad = dirty || ownerId === 'new' ? check() : null;
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      let h = row;
      if (dirty || ownerId === 'new') h = await crm.put<Hoarding>(`/api/v1/hoardings/${row.id}`, body());
      if (to) h = await crm.post<Hoarding>(`/api/v1/hoardings/${row.id}/move`, { to, reason: extra?.reason });
      onChanged(h);
      toast(done);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  const upload = async (f: File | null) => {
    if (!f) return;
    setBusy(true); setErr(null);
    const form = new FormData(); form.append('file', f);
    try { onChanged(await crm.upload<Hoarding>(`/api/v1/hoardings/${row.id}/photos?kind=${photoKind.current}`, form)); toast('Photo added'); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const pickPhoto = (k: 'site' | 'banner') => { photoKind.current = k; fileRef.current?.click(); };

  const running = row.status === 'rented' || row.status === 'live';
  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="hd-drawer" role="dialog" aria-modal="true" aria-label={row.place}>
        <header className="hd-d-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="hd-d-pills">
              <span className="hd-stage" style={{ ['--c' as string]: st.color }}>{st.label}</span>
              {row.stage === 'ending' && <Pill tone="bad">{leftText(row.daysLeft)}</Pill>}
              {row.rentMissing && <Pill tone="warn">Rent not filled in</Pill>}
            </div>
            <h2 className="hd-d-title">{row.place}</h2>
            <div className="crm-sub">{[kindLabel(row.kind), row.size, row.landmark, [row.block, row.district].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Close" onClick={onClose} style={{ width: 36, padding: 0, flex: 'none' }}><X size={16} /></button>
        </header>

        <div className="hd-d-body">
          {row.status === 'rejected' ? (
            <div className="hd-note is-bad"><strong>Not taken.</strong> {row.rejectReason}</div>
          ) : (
            <ol className="hd-steps" aria-label="Where this place is">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i < stepAt ? 'is-done' : i === stepAt ? 'is-now' : ''}>
                  <span className="hd-step-dot">{i < stepAt ? <Check size={12} aria-hidden /> : i + 1}</span>
                  <span className="hd-step-l">{s.label}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="hd-facts">
            <span><User size={14} aria-hidden /> {row.fromAgent ? 'Suggested by' : 'Added by'} <strong>{row.suggestedByName}</strong> on {fmt.date(row.createdAt)}</span>
            <a className="wa-link" style={{ lineHeight: 'inherit' }} href={`https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}`} target="_blank" rel="noreferrer"><MapPin size={14} aria-hidden /> Open in Google Maps <ExternalLink size={12} aria-hidden /></a>
            {editable && <button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={onEdit}><Pencil size={13} aria-hidden /> Edit place or move the pin</button>}
          </div>
          {row.agentNote && <div className="hd-note"><strong>{row.suggestedByName}:</strong> {row.agentNote}</div>}

          <section>
            <div className="hd-label">Photos</div>
            <div className="hd-photos">
              {row.photos.map((p) => <Photo key={p.id} id={p.id} kind={p.kind} />)}
              {row.photos.length === 0 && <span className="crm-sub">No photo yet.</span>}
            </div>
            {editable && (
              <div className="hd-row" style={{ marginTop: 8 }}>
                <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => pickPhoto('site')}><Upload size={14} aria-hidden /> Photo of the place</button>
                <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => pickPhoto('banner')}><Upload size={14} aria-hidden /> Photo of the banner</button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </section>

          <section className="hd-money">
            <div className="hd-label">Rent <span className="hd-private">office only · agents never see this</span></div>
            <div className="hd-grid3">
              <label className="crm-field">Per month (₹)<input className="crm-input" inputMode="numeric" value={rent} disabled={!editable} placeholder="e.g. 4000" onChange={(e) => setRent(e.target.value.replace(/[^\d.]/g, ''))} /></label>
              <label className="crm-field">From<input type="date" className="crm-input" value={start} disabled={!editable} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="crm-field">Until<input type="date" className="crm-input" value={end} min={start || undefined} disabled={!editable} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            {editable && (
              <div className="hd-row">
                <span className="crm-sub" style={{ fontSize: 12.5 }}>{running ? 'Renew for' : 'Rent for'}</span>
                {[1, 3, 6, 12].map((m) => (
                  <button key={m} type="button" className="crm-chip" onClick={() => {
                    const from = running && end && end >= today ? end : start || today;
                    if (!start) setStart(today);
                    setEnd(addMonths(from, m));
                  }}>{m === 12 ? '1 year' : `${m} ${m === 1 ? 'month' : 'months'}`}</button>
                ))}
              </div>
            )}
            {rent && start && end && end >= start && <div className="crm-sub" style={{ fontSize: 13 }}>{dayText(start)} to {dayText(end)} at {rupees(Number(rent))} a month.</div>}
          </section>

          <section>
            <div className="hd-label">Owner</div>
            <select className="crm-select" value={ownerId} disabled={!editable} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Not known yet</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.phone ? ` · ${o.phone}` : ''}</option>)}
              <option value="new">+ New owner…</option>
            </select>
            {ownerId === 'new' && (
              <div className="hd-grid2" style={{ marginTop: 8 }}>
                <input className="crm-input" placeholder="Owner's name" value={ownerName} maxLength={120} onChange={(e) => setOwnerName(e.target.value)} />
                <input className="crm-input" placeholder="Phone (10 digits)" inputMode="tel" value={ownerPhone} maxLength={14} onChange={(e) => setOwnerPhone(e.target.value)} />
              </div>
            )}
            {owner && ownerId === owner.id && (
              <div className="crm-sub" style={{ fontSize: 13, marginTop: 6 }}>
                {owner.phone && <a className="wa-link" style={{ lineHeight: 'inherit' }} href={`tel:${owner.phone}`}>{owner.phone}</a>}
                {siblings.length > 0 && <> {owner.phone ? '· ' : ''}Also owns: {siblings.map((h, i) => <span key={h.id}>{i > 0 && ', '}<button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={() => onOpen(h.id)}>{h.place}</button></span>)}</>}
              </div>
            )}
          </section>

          <label className="crm-field">Office note<textarea className="crm-textarea" value={note} disabled={!editable} maxLength={1000} placeholder="Anything to remember about this place or the deal" onChange={(e) => setNote(e.target.value)} /></label>

          {rejecting && (
            <div className="hd-reject">
              <label className="crm-field">Why not? The agent sees this.
                <input className="crm-input" autoFocus value={reason} maxLength={300} placeholder="e.g. Too far from the main road" onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="hd-row">
                <button type="button" className="crm-btn is-danger is-sm" disabled={busy || !reason.trim()} onClick={() => void run('rejected', 'Marked as not taken. The agent is told.', { reason })}>Not taking it</button>
                <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            </div>
          )}
          {err && <div className="crm-error" role="alert">{err}</div>}
        </div>

        {editable && (
          <footer className="hd-d-foot">
            {row.status === 'suggested' && <>
              <button type="button" className="crm-btn is-ok" disabled={busy} onClick={() => void run('approved', 'Approved. The agent is told to go ahead.')}>Approve</button>
              <button type="button" className="crm-btn is-danger" disabled={busy} onClick={() => setRejecting(true)}>Not taking it</button>
            </>}
            {row.status === 'approved' && <button type="button" className="crm-btn" disabled={busy} onClick={() => void run('rented', 'Marked as rented.')}>Mark rented</button>}
            {row.status === 'rented' && <button type="button" className="crm-btn is-ok" disabled={busy} onClick={() => void run('live', 'Marked: banner is up.')}>Banner is up</button>}
            {running && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void run('ended', 'Rental ended.')}>End rental</button>}
            {row.status === 'ended' && <button type="button" className="crm-btn" disabled={busy} onClick={() => void run('rented', 'Rented again.')}>Rent it again</button>}
            {row.status === 'rejected' && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void run('suggested', 'Back in Suggested.')}>Look at it again</button>}
            {(dirty || ownerId === 'new') && <button type="button" className="crm-btn is-secondary" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void run(null, 'Saved')}>{busy ? 'Saving…' : 'Save changes'}</button>}
          </footer>
        )}
      </aside>
    </>
  );
}

