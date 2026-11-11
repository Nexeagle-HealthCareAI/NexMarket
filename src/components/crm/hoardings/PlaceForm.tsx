'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import { KIND_LABEL, type Hoarding } from '@/lib/crm/hoardings';

const HoardingMap = dynamic(() => import('./HoardingMap'), { ssr: false });

/** Add a place from the office, or correct one an agent sent: its name, what kind of space it is, and the exact spot. */
export function PlaceForm({ row, kinds, onClose, onSaved }: { row: Hoarding | null; kinds: string[]; onClose: () => void; onSaved: (h: Hoarding) => void }) {
  const [place, setPlace] = useState(row?.place ?? '');
  const [landmark, setLandmark] = useState(row?.landmark ?? '');
  const [block, setBlock] = useState(row?.block ?? '');
  const [district, setDistrict] = useState(row?.district ?? '');
  const [kind, setKind] = useState(row?.kind ?? 'hoarding');
  const [size, setSize] = useState(row?.size ?? '');
  const [at, setAt] = useState<[number, number] | null>(row ? [row.lat, row.lng] : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!place.trim()) { setErr('Write the name of the place.'); return; }
    if (!at) { setErr('Click the map where the hoarding is.'); return; }
    setBusy(true); setErr(null);
    const body = { place, landmark, block, district, kind, size, lat: at[0], lng: at[1] };
    try { onSaved(row ? await crm.put<Hoarding>(`/api/v1/hoardings/${row.id}`, body) : await crm.post<Hoarding>('/api/v1/hoardings', body)); }
    catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  return (
    <Modal wide title={row ? 'Edit place' : 'Add a hoarding place'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : row ? 'Save' : 'Add place'}</button>
    </>}>
      <div className="crm-form-grid">
        <label className="crm-field">Place<input className="crm-input" value={place} maxLength={160} placeholder="e.g. Gandhi Chowk, Kishanganj" onChange={(e) => setPlace(e.target.value)} /></label>
        <label className="crm-field">Landmark<input className="crm-input" value={landmark} maxLength={200} placeholder="e.g. above Sharma Medical" onChange={(e) => setLandmark(e.target.value)} /></label>
        <label className="crm-field">Kind
          <select className="crm-select" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>
        </label>
        <label className="crm-field">Size<input className="crm-input" value={size} maxLength={60} placeholder="e.g. 20 x 10 ft" onChange={(e) => setSize(e.target.value)} /></label>
        <label className="crm-field">Block<input className="crm-input" value={block} maxLength={80} onChange={(e) => setBlock(e.target.value)} /></label>
        <label className="crm-field">District<input className="crm-input" value={district} maxLength={80} onChange={(e) => setDistrict(e.target.value)} /></label>
      </div>
      <div>
        <div className="hd-label">{at ? 'Drag the pin to the exact spot' : 'Click the map where the hoarding is'}</div>
        <HoardingMap pins={[]} pick={at} onPick={setAt} height={300} />
      </div>
      {err && <div className="crm-error" role="alert">{err}</div>}
    </Modal>
  );
}
