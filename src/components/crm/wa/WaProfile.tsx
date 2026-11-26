'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Camera, Clock, ExternalLink, Globe, Mail, MapPin, Store } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Skeleton } from '@/components/crm/ui';

interface Profile {
  about?: string | null; description?: string | null; address?: string | null; email?: string | null;
  websites: string[]; vertical?: string | null; photoUrl?: string | null;
  name?: string | null; nameStatus?: string | null; number?: string | null; hospitalName: string;
  verticals: { code: string; label: string }[]; appIdSaved: boolean;
}
interface Form { about: string; description: string; address: string; email: string; site1: string; site2: string; vertical: string }

const toForm = (p: Profile): Form => ({
  about: p.about ?? '', description: p.description ?? '', address: p.address ?? '', email: p.email ?? '',
  site1: p.websites[0] ?? '', site2: p.websites[1] ?? '', vertical: p.vertical && p.vertical !== 'UNDEFINED' ? p.vertical : 'HEALTH',
});

const NAME_STATE: Record<string, { label: string; tone: 'ok' | 'wait' | 'bad' }> = {
  APPROVED: { label: 'Approved', tone: 'ok' }, AVAILABLE_WITHOUT_REVIEW: { label: 'Approved', tone: 'ok' },
  PENDING_REVIEW: { label: 'In review', tone: 'wait' }, NONE: { label: 'In review', tone: 'wait' },
  DECLINED: { label: 'Declined', tone: 'bad' }, EXPIRED: { label: 'Expired', tone: 'bad' },
};

/** A square 640×640 JPEG from any picture: the middle of it, as WhatsApp shows profile photos in a circle. */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file isn\'t a picture.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (side < 192) throw new Error('The picture is too small. Use one at least 640 pixels wide.');
    const size = Math.min(640, side);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); // a transparent logo gets a white background
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Couldn\'t read the picture.'))), 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}

/** What patients see when they open the hospital's WhatsApp chat: photo, about, description, address, websites. Saved straight to Meta. */
export function WaProfile({ connected, onToast, onSetup }: { connected: boolean | null; onToast: (m: string) => void; onSetup?: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [needApp, setNeedApp] = useState(false);
  const [appId, setAppId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /** `keepForm`: after a photo upload, so text being typed isn't lost. */
  const load = useCallback(async (keepForm = false) => {
    try { const r = await crm.get<Profile>('/api/v1/settings/whatsapp/profile'); setP(r); if (!keepForm) setForm(toForm(r)); setErr(null); }
    catch (e) { setErr(friendlyError(e)); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server once connected
  useEffect(() => { if (connected) void load(); }, [connected, load]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  if (connected === null) return <Skeleton h={320} />;
  if (!connected) return (
    <section className="crm-card wa-step">
      <span className="wa-err"><AlertTriangle size={14} aria-hidden /> Connect the WhatsApp number first, then come back to set up its profile.</span>
      {onSetup && <button type="button" className="crm-btn" style={{ alignSelf: 'flex-start' }} onClick={onSetup}>Go to Account setup</button>}
    </section>
  );

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const dirty = !!p && !!form && JSON.stringify(form) !== JSON.stringify(toForm(p));

  const save = async () => {
    if (!form) return;
    if (!form.about.trim()) { onToast('Write the "About" line.'); return; }
    setSaving(true);
    try {
      await crm.put('/api/v1/settings/whatsapp/profile', {
        about: form.about, description: form.description, address: form.address, email: form.email,
        websites: [form.site1, form.site2].filter((s) => s.trim()), vertical: form.vertical,
      });
      onToast('Profile saved on WhatsApp. Phones show it within a few minutes.');
      await load();
    } catch (e) { onToast(friendlyError(e)); }
    finally { setSaving(false); }
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { const blob = await squareJpeg(f); setPhoto({ blob, url: URL.createObjectURL(blob) }); }
    catch (x) { onToast(x instanceof Error ? x.message : 'Couldn\'t read the picture.'); }
  };

  const upload = async () => {
    if (!photo) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', photo.blob, 'profile.jpg');
      if (appId.trim()) fd.append('appId', appId.trim());
      await crm.upload('/api/v1/settings/whatsapp/profile/photo', fd);
      onToast('Profile photo updated on WhatsApp.');
      setPhoto(null); setNeedApp(false);
      await load(true);
    } catch (x) {
      const m = friendlyError(x);
      if (/app id|app\b/i.test(m)) setNeedApp(true);
      onToast(m);
    } finally { setUploading(false); }
  };

  const ns = p?.nameStatus ? NAME_STATE[p.nameStatus] ?? { label: p.nameStatus.toLowerCase().replace(/_/g, ' '), tone: 'wait' as const } : null;
  const shownPhoto = photo?.url ?? p?.photoUrl ?? null;
  const initial = (p?.name ?? p?.hospitalName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <section className="crm-card wa-step">
      <div className="wa-step-head">
        <span className="wa-num" aria-hidden><Store size={17} /></span>
        <div>
          <h2 className="crm-h2">Business profile on WhatsApp</h2>
          <p className="crm-sub">What patients see when they tap the {p?.hospitalName ?? 'hospital'} name in a chat. Saved straight to WhatsApp; phones show changes within a few minutes.</p>
        </div>
      </div>

      {err ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> {err}</span>
        : !p || !form ? <Skeleton h={260} />
          : (
            <div className="wp-wrap">
              <div className="wp-edit">
                {/* Photo */}
                <div className="wa-field">
                  <span className="wa-label">Profile photo</span>
                  <div className="wp-photo-row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a picture from Meta or just picked */}
                    <span className="wp-avatar is-sm">{shownPhoto ? <img src={shownPhoto} alt="" /> : initial}</span>
                    <div className="wp-photo-actions">
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e)} />
                      <button type="button" className="crm-btn is-secondary is-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                        <Camera size={15} aria-hidden /> {photo ? 'Choose another' : shownPhoto ? 'Change photo' : 'Choose photo'}
                      </button>
                      {photo && <button type="button" className="crm-btn is-sm" onClick={() => void upload()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload to WhatsApp'}</button>}
                      {photo && !uploading && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPhoto(null)}>Cancel</button>}
                    </div>
                  </div>
                  <span className="wa-hint">The {p.hospitalName} logo works best. The middle is cut to a square; WhatsApp shows it in a circle.</span>
                  {needApp && (
                    <label className="wa-field wp-appid">
                      <span className="wa-label">Meta App ID</span>
                      <input className="crm-input" value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="e.g. 2111451422808117" />
                      <span className="wa-hint">Meta app → App settings → Basic → App ID. Asked once, then remembered.</span>
                    </label>
                  )}
                </div>

                {/* Name (changed in Meta, reviewed) */}
                <div className="wa-field">
                  <span className="wa-label">Display name</span>
                  <div className="wp-name">
                    <strong>{p.name ?? '—'}</strong>
                    {ns && <span className={`wp-state is-${ns.tone}`}>{ns.tone === 'ok' ? <BadgeCheck size={13} aria-hidden /> : ns.tone === 'wait' ? <Clock size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {ns.label}</span>}
                  </div>
                  <span className="wa-hint">
                    Meta reviews every name, so it&apos;s changed there: Business settings → WhatsApp accounts → this number → Display name → Edit.
                    {ns?.tone === 'wait' ? ' It can\'t be edited until the current review finishes.' : ''}{' '}
                    <a href="https://business.facebook.com/latest/settings/whatsapp_account" target="_blank" rel="noreferrer">Open Meta <ExternalLink size={12} aria-hidden /></a>
                  </span>
                </div>

                <div className="wa-grid">
                  <label className="wa-field">
                    <span className="wa-label">About (one line)</span>
                    <input className="crm-input" value={form.about} onChange={set('about')} maxLength={139} placeholder="Free health camps · OPD · 24×7 emergency" />
                    <span className="wa-hint">{form.about.length}/139 · shown under the name</span>
                  </label>
                  <label className="wa-field">
                    <span className="wa-label">Category</span>
                    <select className="crm-select" value={form.vertical} onChange={set('vertical')}>
                      {p.verticals.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="wa-field">
                  <span className="wa-label">Description</span>
                  <textarea className="crm-textarea" rows={3} value={form.description} onChange={set('description')} maxLength={512}
                    placeholder={`${p.hospitalName}, Purnia. OPD, emergency, free health camps across Seemanchal. Book appointments and camp tokens here.`} />
                  <span className="wa-hint">{form.description.length}/512</span>
                </label>
                <label className="wa-field">
                  <span className="wa-label">Address</span>
                  <textarea className="crm-textarea" rows={2} value={form.address} onChange={set('address')} maxLength={256} placeholder="Full address, with landmark and PIN code" />
                </label>
                <div className="wa-grid">
                  <label className="wa-field">
                    <span className="wa-label">Email (optional)</span>
                    <input className="crm-input" type="email" value={form.email} onChange={set('email')} maxLength={128} placeholder="info@…" />
                  </label>
                  <label className="wa-field">
                    <span className="wa-label">Website</span>
                    <input className="crm-input" value={form.site1} onChange={set('site1')} placeholder="https://…" />
                  </label>
                  <div />
                  <label className="wa-field">
                    <span className="wa-label">Second website (optional)</span>
                    <input className="crm-input" value={form.site2} onChange={set('site2')} placeholder="e.g. the booking page" />
                  </label>
                </div>
                <div className="wp-actions">
                  {dirty && <button type="button" className="crm-btn is-secondary" onClick={() => setForm(toForm(p))} disabled={saving}>Discard</button>}
                  <button type="button" className="crm-btn" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save profile'}</button>
                </div>
              </div>

              {/* Phone preview */}
              <div className="wp-phone" aria-label="How it looks on a phone">
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture from Meta or just picked */}
                <span className="wp-avatar">{shownPhoto ? <img src={shownPhoto} alt="" /> : initial}</span>
                <strong className="wp-phone-name">{p.name ?? p.hospitalName}</strong>
                {p.number && <span className="wp-phone-num">{p.number}</span>}
                {form.about && <span className="wp-phone-about">{form.about}</span>}
                <div className="wp-phone-list">
                  {form.description && <p>{form.description}</p>}
                  <span><Store size={14} aria-hidden /> {p.verticals.find((v) => v.code === form.vertical)?.label}</span>
                  {form.address && <span><MapPin size={14} aria-hidden /> {form.address}</span>}
                  {form.email && <span><Mail size={14} aria-hidden /> {form.email}</span>}
                  {[form.site1, form.site2].filter((s) => s.trim()).map((s) => <span key={s} className="is-link"><Globe size={14} aria-hidden /> {s}</span>)}
                </div>
              </div>
            </div>
          )}
    </section>
  );
}
