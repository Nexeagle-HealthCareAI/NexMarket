'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { compressImageToBlob } from '@/lib/image/compressImage';
import { friendlyError, initials, Modal, Skeleton } from '@/components/crm/ui';

interface Detail {
  agentId: string; name: string; firstName?: string | null; middleName?: string | null; lastName?: string | null;
  phone: string; email?: string | null; role: string; district: string; block: string;
  dateOfBirth?: string | null; gender?: string | null; address?: string | null; pincode?: string | null;
  education?: string | null; workExperience?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null;
  photoUrl?: string | null; personalDetails?: string | null;
}

type Form = {
  firstName: string; middleName: string; lastName: string; phone: string; email: string; dateOfBirth: string; gender: string;
  address: string; pincode: string; district: string; block: string; education: string; workExperience: string;
  emergencyContactName: string; emergencyContactPhone: string; personalDetails: string; photoUrl: string;
};

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Upload a profile photo (made smaller first) and return its URL. */
export async function uploadProfilePhoto(file: File): Promise<string> {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error('Use a JPG, PNG or WebP photo.');
  const blob = await compressImageToBlob(file, { maxDimension: 800, quality: 0.8 });
  const fd = new FormData();
  fd.append('file', blob, 'profile.jpg');
  const r = await crm.upload<{ url: string }>('/api/v1/sync/photo', fd);
  return r.url;
}

/** Round photo with change / remove; falls back to initials. */
export function PhotoPicker({ name, url, onChange, busy, setBusy, onError }: {
  name: string; url: string; onChange: (url: string) => void; busy: boolean; setBusy: (b: boolean) => void; onError: (msg: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { onChange(await uploadProfilePhoto(f)); } catch (e) { onError(friendlyError(e)); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="ep-photo">
      <span className="ep-avatar" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" /> : <span>{initials(name || '?')}</span>}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Profile photo</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => input.current?.click()}>
            <Camera size={14} aria-hidden /> {busy ? 'Uploading…' : url ? 'Change photo' : 'Upload photo'}
          </button>
          {url && <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => onChange('')}><Trash2 size={14} aria-hidden /> Remove</button>}
        </span>
        <span className="crm-cell-sub">JPG, PNG or WebP. Shown in the CRM and the app.</span>
      </div>
      <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

const toForm = (d: Detail): Form => {
  const parts = d.name.trim().split(/\s+/);
  return {
    firstName: d.firstName ?? parts[0] ?? '', middleName: d.middleName ?? '', lastName: d.lastName ?? (parts.length > 1 ? parts[parts.length - 1] : ''),
    phone: d.phone ?? '', email: d.email ?? '', dateOfBirth: d.dateOfBirth ? d.dateOfBirth.slice(0, 10) : '', gender: d.gender ?? '',
    address: d.address ?? '', pincode: d.pincode ?? '', district: d.district ?? '', block: d.block ?? '', education: d.education ?? '',
    workExperience: d.workExperience ?? '', emergencyContactName: d.emergencyContactName ?? '', emergencyContactPhone: d.emergencyContactPhone ?? '',
    personalDetails: d.personalDetails ?? '', photoUrl: d.photoUrl ?? '',
  };
};

/** Edit everything about a person: name, contact, photo, address, background and emergency contact. */
export function EditPerson({ agentId, onClose, onDone }: { agentId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    crm.get<Detail>(`/api/v1/agents/${encodeURIComponent(agentId)}`)
      .then((d) => { if (alive) { setDetail(d); setForm(toForm(d)); } })
      .catch((e) => { if (alive) setLoadError(friendlyError(e)); });
    return () => { alive = false; };
  }, [agentId]);

  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form || !detail) return;
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter first and last name.');
    if (!/^\d{10}$/.test(form.phone)) return setError('Mobile number must be exactly 10 digits.');
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    if (form.emergencyContactPhone && !/^\d{10}$/.test(form.emergencyContactPhone)) return setError('Emergency contact number must be 10 digits.');
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) return setError('PIN code must be 6 digits.');
    if (!form.district.trim() || !form.block.trim()) return setError('Enter district and block.');
    setSaving(true);
    try {
      await crm.put(`/api/v1/agents/${encodeURIComponent(agentId)}/profile`, {
        firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim(),
        phone: form.phone, email: form.email.trim(), dateOfBirth: form.dateOfBirth || null, gender: form.gender,
        address: form.address.trim(), pincode: form.pincode.trim(), district: form.district.trim(), block: form.block.trim(),
        education: form.education.trim(), workExperience: form.workExperience.trim(),
        emergencyContactName: form.emergencyContactName.trim(), emergencyContactPhone: form.emergencyContactPhone,
        personalDetails: form.personalDetails.trim(), photoUrl: form.photoUrl,
      });
      onDone(`${[form.firstName.trim(), form.lastName.trim()].join(' ')}’s details saved.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const title = detail ? `Edit details · ${detail.name}` : 'Edit details';
  return (
    <Modal wide title={title} onClose={onClose} actions={form && <>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={saving || uploading} onClick={save}>{saving ? 'Saving…' : 'Save details'}</button>
    </>}>
      {loadError ? <div className="crm-error" role="alert">{loadError}</div> : !form || !detail ? <Skeleton h={320} /> : (
        <>
          <PhotoPicker name={`${form.firstName} ${form.lastName}`} url={form.photoUrl} onChange={(u) => set('photoUrl', u)} busy={uploading} setBusy={setUploading} onError={setError} />

          <fieldset className="ep-group">
            <legend>Name</legend>
            <div className="crm-form-grid">
              <label className="crm-field">First name<input className="crm-input" value={form.firstName} maxLength={50} onChange={(e) => set('firstName', e.target.value)} /></label>
              <label className="crm-field">Middle name (optional)<input className="crm-input" value={form.middleName} maxLength={50} onChange={(e) => set('middleName', e.target.value)} /></label>
              <label className="crm-field">Last name<input className="crm-input" value={form.lastName} maxLength={50} onChange={(e) => set('lastName', e.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="ep-group">
            <legend>Contact</legend>
            <div className="crm-form-grid">
              <label className="crm-field">Mobile number<input className="crm-input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} /></label>
              <label className="crm-field">Email (optional)<input className="crm-input" type="email" value={form.email} maxLength={120} onChange={(e) => set('email', e.target.value)} /></label>
            </div>
            <span className="crm-cell-sub">They still sign in with their user ID ({detail.agentId}); changing the number doesn’t change their login.</span>
          </fieldset>

          <fieldset className="ep-group">
            <legend>Personal</legend>
            <div className="crm-form-grid">
              <label className="crm-field">Date of birth<input className="crm-input" type="date" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dateOfBirth', e.target.value)} /></label>
              <label className="crm-field">Gender
                <select className="crm-select" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Not given</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="crm-field">Education<input className="crm-input" value={form.education} maxLength={120} onChange={(e) => set('education', e.target.value)} placeholder="e.g. B.A., ANM, 12th pass" /></label>
              <label className="crm-field">Work experience<input className="crm-input" value={form.workExperience} maxLength={200} onChange={(e) => set('workExperience', e.target.value)} placeholder="e.g. 3 years in pharma sales" /></label>
            </div>
          </fieldset>

          <fieldset className="ep-group">
            <legend>Address & work area</legend>
            <label className="crm-field">Address<textarea className="crm-textarea" rows={2} value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)} /></label>
            <div className="crm-form-grid">
              <label className="crm-field">PIN code<input className="crm-input" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} /></label>
              <label className="crm-field">District<input className="crm-input" value={form.district} maxLength={50} onChange={(e) => set('district', e.target.value)} /></label>
              <label className="crm-field">Block<input className="crm-input" value={form.block} maxLength={50} onChange={(e) => set('block', e.target.value)} /></label>
            </div>
            <span className="crm-cell-sub">The block they work in day to day is set on Block assignments.</span>
          </fieldset>

          <fieldset className="ep-group">
            <legend>Emergency contact</legend>
            <div className="crm-form-grid">
              <label className="crm-field">Name<input className="crm-input" value={form.emergencyContactName} maxLength={80} onChange={(e) => set('emergencyContactName', e.target.value)} /></label>
              <label className="crm-field">Mobile number<input className="crm-input" inputMode="numeric" maxLength={10} value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value.replace(/\D/g, ''))} /></label>
            </div>
          </fieldset>

          <label className="crm-field">Notes (optional)<textarea className="crm-textarea" rows={2} value={form.personalDetails} maxLength={500} onChange={(e) => set('personalDetails', e.target.value)} placeholder="Anything else the office should know" /></label>
          <p className="crm-note" style={{ margin: 0 }}>To change their role use “Change role”; every change here is kept in the activity log.</p>
          {error && <div className="crm-error" role="alert">{error}</div>}
        </>
      )}
    </Modal>
  );
}
