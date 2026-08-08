'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveVisit, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { compressImage } from '@/lib/image/compressImage';
import type { ContactRole, LocalContact } from '@/lib/db/schema';



import { useTranslations } from '@/i18n/I18nProvider';
import SurveyClient from '@/app/(agent)/survey/SurveyClient';

// Tapping the camera button backgrounds the browser tab to hand off to the
// native camera app — on a lot of Android devices, a backgrounded tab gets
// its memory reclaimed by the OS and is silently reloaded when it comes back
// to the foreground, wiping every bit of in-memory React state, including
// this whole unsaved form. That's not something a JS fix can prevent (it's
// the browser/OS deciding to kill the tab), so instead the form is
// continuously saved as a draft and restored on mount — a reload loses the
// React state but not the draft sitting in localStorage.
const DRAFT_KEY = 'newContactDraft';

interface ContactFormState {
  name: string;
  role: ContactRole | '';
  panchayatId: string;
  phone: string;
  whatsappAdded: boolean;
  cardGiven: boolean;
  notes: string;
  status: 'Lead' | 'Contacted' | 'Interested' | 'Converted' | 'Rejected';
  followUpDate: string;
  photoDataUri: string;
}

function emptyForm(panchayatId = ''): ContactFormState {
  return {
    name: '', role: '', panchayatId, phone: '', whatsappAdded: false,
    cardGiven: false, notes: '', status: 'Lead', followUpDate: '', photoDataUri: '',
  };
}

function isMeaningfulDraft(draft: Partial<ContactFormState>): boolean {
  return !!(draft.name || draft.phone || draft.notes || draft.role || draft.photoDataUri);
}

export default function NewContactPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeShiftClientId = useAgentStore((s) => s.activeShiftClientId);

  const panchayats = usePanchayats();
  const activeVisit = useActiveVisit(agentId ?? undefined);
  const { position } = useGeolocation();
  const t = useTranslations();

  const ROLES: { value: ContactRole; label: string; emoji: string; desc: string }[] = [
    { value: 'asha_worker',      label: t.roleAshaWorker,      emoji: '🤝', desc: t.descAshaWorker },
    { value: 'rmp_doctor',       label: t.roleRmpDoctor,       emoji: '🩺', desc: t.descRmpDoctor },
    { value: 'medicine_shop',    label: t.roleMedicineShop,    emoji: '🏪', desc: t.descMedicineShop },
    { value: 'ward_member',      label: t.roleWardMember,      emoji: '🏛️', desc: t.descWardMember },
    { value: 'mukhiya',          label: t.roleMukhiya,         emoji: '👑', desc: t.descMukhiya },
    { value: 'prominent_person', label: t.roleProminentPerson, emoji: '🌟', desc: t.descProminentPerson },
  ];

  const [form, setForm] = useState<ContactFormState>(() => {
    const defaults = emptyForm(activeVisit?.panchayatId ?? '');
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      const draft = raw ? (JSON.parse(raw) as Partial<ContactFormState>) : null;
      if (draft && isMeaningfulDraft(draft)) return { ...defaults, ...draft };
    } catch {
      // Corrupt/unparseable draft — fall back to a clean form rather than crash.
    }
    return defaults;
  });
  const [draftRestored] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      return !!raw && isMeaningfulDraft(JSON.parse(raw));
    } catch {
      return false;
    }
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newContactId, setNewContactId] = useState<string | null>(null);

  // Continuously persist the in-progress form so it survives the tab reload
  // above — debounced so rapid typing doesn't hit localStorage on every
  // keystroke. Only ever written for a form with actual content; an empty
  // draft is just removed, so a blank visit here doesn't leave a stale draft
  // to (harmlessly, but confusingly) restore next time.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (isMeaningfulDraft(form)) {
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
        } else {
          window.localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        // localStorage unavailable/full — draft persistence is best-effort.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form]);

  // useActiveVisit is an async Dexie live-query — it's still undefined on the
  // very first render, so the useState initializer above almost never actually
  // captures it. Sync it in once it loads, but never clobber a panchayat the
  // agent has already picked themselves.
  useEffect(() => {
    if (!activeVisit?.panchayatId) return;
    setForm((prev) => (prev.panchayatId ? prev : { ...prev, panchayatId: activeVisit.panchayatId }));
  }, [activeVisit?.panchayatId]);

  // Group panchayats by district for the select dropdown
  const groupedPanchayats = useMemo(() => {
    if (!panchayats) return {};
    return panchayats.reduce<Record<string, typeof panchayats>>((acc, p) => {
      (acc[p.district] ??= []).push(p);
      return acc;
    }, {});
  }, [panchayats]);

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      update('photoDataUri', await compressImage(file));
    } catch {
      // Compression failing (corrupt file, canvas unavailable) shouldn't block
      // the rest of the form — the contact can still be saved without a photo.
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.errNameRequired); return; }
    if (!form.role) { setError(t.errContactType); return; }
    if (!form.panchayatId) { setError(t.errPanchayat); return; }
    if (!agentId || !deviceId) { setError(t.errNotLoggedIn); return; }

    setSaving(true);
    setError('');

    const now = new Date().toISOString();
    const clientId = uuidv4();

    const contact: LocalContact = {
      clientId,
      deviceId,
      agentId,
      panchayatId: form.panchayatId,
      shiftId: activeShiftClientId ?? undefined,
      name: form.name.trim(),
      role: form.role as ContactRole,
      phone: form.phone.trim() || undefined,
      whatsappAdded: form.whatsappAdded,
      cardGiven: form.cardGiven,
      notes: form.notes.trim() || undefined,
      status: form.status,
      followUpDate: form.followUpDate || undefined,
      photoDataUri: form.photoDataUri || undefined,
      lat: position?.lat,
      lng: position?.lng,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.contacts.add(contact);
      await addToOutbox(clientId, deviceId, 'contact', contact);
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      // Show survey modal instead of routing away immediately
      setNewContactId(clientId);
    } catch (err) {
      setError(t.errSaveContact);
      setSaving(false);
    }
  }

  if (newContactId) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
        <SurveyClient contactId={newContactId} onClose={() => router.push('/contacts')} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
            aria-label="Go back"
          >
            ← 
          </button>
          <h1>{t.newContact}</h1>
        </div>
      </div>

      {draftRestored && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1rem' }}>
          ℹ️ Restored what you already typed — looks like the app got reloaded (this can happen when the camera opens).
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Contact Type */}
        <div>
          <p className="field-label" style={{ marginBottom: '0.5rem' }}>{t.contactType}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                id={`role-${r.value}`}
                onClick={() => update('role', r.value)}
                style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1.5px solid',
                  borderColor: form.role === r.value ? 'var(--color-primary-500)' : 'var(--surface-border)',
                  background: form.role === r.value ? 'rgba(99,102,241,0.12)' : 'var(--surface-input)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 120ms ease',
                }}
              >
                <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{r.emoji}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-name">{t.fullName}</label>
          <input
            id="contact-name"
            className="field-input"
            type="text"
            placeholder={t.namePlaceholder}
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            autoComplete="name"
            required
            minLength={2}
            maxLength={50}
            pattern="^[A-Za-zऀ-ॿ.'\-\s]+$"
            title="Name must contain only letters, spaces, periods, hyphens or apostrophes"
          />
        </div>

        {/* Panchayat */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-panchayat">{t.panchayatLabel}</label>
          <select
            id="contact-panchayat"
            className="field-input"
            value={form.panchayatId}
            onChange={(e) => update('panchayatId', e.target.value)}
            required
          >
            <option value="">{t.selectPanchayat}</option>
            {Object.entries(groupedPanchayats).sort().map(([district, list]) => (
              <optgroup key={district} label={district}>
                {list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.block})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Phone */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-phone">{t.mobileNumber}</label>
          <input
            id="contact-phone"
            className="field-input"
            type="tel"
            inputMode="numeric"
            placeholder={t.mobilePlaceholder}
            minLength={10}
            maxLength={10}
            pattern="^[0-9]{10}$"
            title="Mobile number must be exactly 10 digits"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value.replace(/\D/g, ''))}
            autoComplete="tel"
          />
        </div>

        {/* Toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div
            className="toggle-row"
            role="checkbox"
            aria-checked={form.whatsappAdded}
            tabIndex={0}
            onClick={() => update('whatsappAdded', !form.whatsappAdded)}
            onKeyDown={(e) => e.key === 'Enter' && update('whatsappAdded', !form.whatsappAdded)}
            id="whatsapp-toggle"
          >
            <span className="toggle-label">{t.addedToWhatsapp}</span>
            <div className={`toggle-switch${form.whatsappAdded ? ' on' : ''}`} />
          </div>

          <div
            className="toggle-row"
            role="checkbox"
            aria-checked={form.cardGiven}
            tabIndex={0}
            onClick={() => update('cardGiven', !form.cardGiven)}
            onKeyDown={(e) => e.key === 'Enter' && update('cardGiven', !form.cardGiven)}
            id="card-toggle"
          >
            <span className="toggle-label">{t.partnerCardGiven}</span>
            <div className={`toggle-switch${form.cardGiven ? ' on' : ''}`} />
          </div>
        </div>

        {/* Notes */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-notes">{t.notesLabel}</label>
          <textarea
            id="contact-notes"
            className="field-input"
            placeholder={t.notesPlaceholder}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
          />
        </div>

        {/* CRM Workflows: Lead Status, Follow-up, Photo */}
        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b' }}>{t.crmDetails}</h3>
          
          <div className="field-group">
            <label className="field-label" htmlFor="contact-status">{t.leadStatus}</label>
            <select
              id="contact-status"
              className="field-input"
              value={form.status}
              onChange={(e) => update('status', e.target.value as any)}
            >
              <option value="Lead">{t.statusLead}</option>
              <option value="Contacted">{t.statusContacted}</option>
              <option value="Interested">{t.statusInterested}</option>
              <option value="Converted">{t.statusConverted}</option>
              <option value="Rejected">{t.statusRejected}</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="contact-followup">{t.followUpDate}</label>
            <input
              id="contact-followup"
              className="field-input"
              type="date"
              value={form.followUpDate}
              onChange={(e) => update('followUpDate', e.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="contact-photo">{t.capturePhoto}</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <input
                id="contact-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => document.getElementById('contact-photo')?.click()}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'white',
                  border: '1px solid var(--color-primary-300)',
                  color: 'var(--color-primary-600)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                {t.btnTakePhoto}
              </button>
              {form.photoDataUri && <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>{t.photoAttached}</span>}
            </div>
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        )}

        <button
          id="save-contact-btn"
          type="submit"
          className="btn btn-primary btn-full btn-lg"
          disabled={saving}
          style={{ marginBottom: '1rem' }}
        >
          {saving ? t.saving : t.btnSaveContact}
        </button>
      </form>
    </div>
  );
}
