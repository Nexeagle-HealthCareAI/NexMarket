'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveVisit, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { compressImage, compressDocumentImage } from '@/lib/image/compressImage';
import AddMissingPanchayatButton from '@/components/AddMissingPanchayatButton';
import type { ContactRole, LocalContact, LocalContactDocument } from '@/lib/db/schema';
import { useTranslations } from '@/i18n/I18nProvider';
import SurveyClient from '@/app/(agent)/survey/SurveyClient';

const DRAFT_KEY = 'newContactDraft';

interface ContactFormState {
  name: string;
  role: ContactRole | '';
  profession: string;
  panchayatId: string;
  phone: string;
  whatsappAdded: boolean;
  cardGiven: boolean;
  notes: string;
  complaints: string;
  conflicts: string;
  status: 'Lead' | 'Contacted' | 'Interested' | 'Converted' | 'Rejected';
  followUpDate: string;
  photoDataUri: string;
  agentEscalated: boolean;
  agentEscalationNote: string;
  documents: { id: string; dataUri: string; mimeType: string; label: string; exifLat?: number | null; exifLng?: number | null; exifCapturedAt?: string | null }[];
}

function emptyForm(panchayatId = ''): ContactFormState {
  return {
    name: '', role: '', profession: '', panchayatId, phone: '', whatsappAdded: false,
    cardGiven: false, notes: '', complaints: '', conflicts: '', status: 'Lead', followUpDate: '', photoDataUri: '',
    agentEscalated: false, agentEscalationNote: '', documents: []
  };
}

function isMeaningfulDraft(draft: Partial<ContactFormState>): boolean {
  return !!(draft.name || draft.phone || draft.notes || draft.complaints || draft.conflicts || draft.role || draft.photoDataUri || draft.agentEscalationNote || draft.documents?.length);
}

// Step indicator
function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
      {[1, 2].map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: s <= step ? 'var(--color-primary-600)' : 'var(--surface-input)',
            color: s <= step ? 'white' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.8rem',
            border: s === step ? '2px solid var(--color-primary-600)' : '2px solid transparent',
            transition: 'all 0.3s ease',
          }}>
            {s < step ? '✓' : s}
          </div>
          {s === 1 && <div style={{ height: 2, width: 40, background: step >= 2 ? 'var(--color-primary-400)' : 'var(--surface-border)', borderRadius: 2, transition: 'all 0.3s ease' }} />}
        </div>
      ))}
      <div style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
        {step === 1 ? 'Quick Save' : 'Add Details (optional)'}
      </div>
    </div>
  );
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

  // 2-step form state
  const [step, setStep] = useState<1 | 2>(1);
  // savedContactId: when set, step 1 was saved and we're on step 2 (or showing survey)
  const [savedContactId, setSavedContactId] = useState<string | null>(null);
  const [showSurvey, setShowSurvey] = useState(false);

  const ROLES: { value: ContactRole; label: string; emoji: string; desc: string }[] = [
    { value: 'asha_worker',       label: t.roleAshaWorker,       emoji: '🤝', desc: t.descAshaWorker },
    { value: 'rmp_doctor',        label: t.roleRmpDoctor,        emoji: '🩺', desc: t.descRmpDoctor },
    { value: 'medicine_shop',     label: t.roleMedicineShop,     emoji: '🏪', desc: t.descMedicineShop },
    { value: 'ward_member',       label: t.roleWardMember,       emoji: '🏛️', desc: t.descWardMember },
    { value: 'mukhiya',           label: t.roleMukhiya,          emoji: '👑', desc: t.descMukhiya },
    { value: 'prominent_person',  label: t.roleProminentPerson,  emoji: '🌟', desc: t.descProminentPerson },
    { value: 'lab',               label: t.roleLab,              emoji: '🔬', desc: t.descLab },
    { value: 'nursing_home',      label: t.roleNursingHome,      emoji: '🛏️', desc: t.descNursingHome },
    { value: 'independent_doctor',label: t.roleIndependentDoctor,emoji: '🩺', desc: t.descIndependentDoctor },
    { value: 'hospital',          label: t.roleHospital,         emoji: '🏥', desc: t.descHospital },
    { value: 'other',             label: t.roleOther,            emoji: '👤', desc: t.descOther },
  ];

  const [form, setForm] = useState<ContactFormState>(() => emptyForm(activeVisit?.panchayatId ?? ''));
  const [draftRestored, setDraftRestored] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [panchayatSearch, setPanchayatSearch] = useState('');
  const [showPanchayatList, setShowPanchayatList] = useState(false);

  // Load draft
  useEffect(() => {
    let active = true;
    db.drafts.get(DRAFT_KEY).then((draft) => {
      if (!active) return;
      if (draft && draft.data && isMeaningfulDraft(draft.data)) {
        setForm({ ...emptyForm(activeVisit?.panchayatId ?? ''), ...draft.data });
        setDraftRestored(true);
      }
    }).catch(console.error).finally(() => {
      if (active) setIsLoadingDraft(false);
    });
    return () => { active = false; };
  }, [activeVisit?.panchayatId]);

  // Persist draft
  useEffect(() => {
    if (isLoadingDraft || saving || showSurvey) return;
    const timer = setTimeout(() => {
      if (isMeaningfulDraft(form)) {
        db.drafts.put({ id: DRAFT_KEY, data: form, updatedAt: new Date().toISOString() }).catch(console.error);
      } else {
        db.drafts.delete(DRAFT_KEY).catch(console.error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form, isLoadingDraft, saving, showSurvey]);

  // Auto-fill panchayat from active visit
  useEffect(() => {
    if (!activeVisit?.panchayatId) return;
    setForm((prev) => (prev.panchayatId ? prev : { ...prev, panchayatId: activeVisit.panchayatId }));
  }, [activeVisit?.panchayatId]);

  // Flat sorted panchayat list for search
  const allPanchayats = useMemo(() => {
    if (!panchayats) return [];
    return [...panchayats].sort((a, b) => a.name.localeCompare(b.name));
  }, [panchayats]);

  const filteredPanchayats = useMemo(() => {
    const q = panchayatSearch.trim().toLowerCase();
    if (!q) return allPanchayats.slice(0, 20);
    return allPanchayats.filter(p =>
      p.name.toLowerCase().includes(q) || p.block.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [allPanchayats, panchayatSearch]);

  const selectedPanchayatName = useMemo(() => {
    return allPanchayats.find(p => p.id === form.panchayatId)?.name ?? '';
  }, [allPanchayats, form.panchayatId]);

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
    try { update('photoDataUri', await compressImage(file)); } catch {}
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Document size must be less than 5MB'); return; }
    try {
      let dataUri: string;
      let exifLat: number | null = null;
      let exifLng: number | null = null;
      let exifCapturedAt: string | null = null;
      if (file.type.startsWith('image/')) {
        const compressed = await compressDocumentImage(file);
        dataUri = compressed.dataUri; exifLat = compressed.exifLat; exifLng = compressed.exifLng; exifCapturedAt = compressed.exifCapturedAt;
      } else {
        const { fileToBase64 } = await import('@/lib/image/fileToBase64');
        dataUri = await fileToBase64(file);
      }
      update('documents', [...form.documents, { id: uuidv4(), dataUri, mimeType: file.type || 'application/octet-stream', label: '', exifLat, exifLng, exifCapturedAt }]);
    } catch {}
  };

  // Saves the contact (called from Step 1 submit AND Step 2 final save)
  async function saveContact(finalForm: ContactFormState): Promise<string | null> {
    if (!agentId || !deviceId) { setError(t.errNotLoggedIn); return null; }
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const clientId = savedContactId ?? uuidv4();
    const contact: LocalContact = {
      clientId, deviceId, agentId,
      panchayatId: finalForm.panchayatId,
      shiftId: activeShiftClientId ?? undefined,
      name: finalForm.name?.trim() || '',
      role: finalForm.role as ContactRole,
      profession: finalForm.role === 'prominent_person' ? (finalForm.profession?.trim() || undefined) : undefined,
      phone: finalForm.phone?.trim() || undefined,
      whatsappAdded: finalForm.whatsappAdded,
      cardGiven: finalForm.cardGiven,
      notes: finalForm.notes?.trim() || undefined,
      complaints: finalForm.complaints?.trim() || undefined,
      conflicts: finalForm.conflicts?.trim() || undefined,
      status: finalForm.status,
      followUpDate: finalForm.followUpDate || undefined,
      photoDataUri: finalForm.photoDataUri || undefined,
      agentEscalated: finalForm.agentEscalated,
      agentEscalationNote: finalForm.agentEscalationNote?.trim() || undefined,
      lat: position?.lat, lng: position?.lng,
      createdAt: now, updatedAt: now,
    };
    try {
      // Upsert: if we already saved in Step 1, update; otherwise insert
      if (savedContactId) {
        const existing = (await db.contacts.toArray()).find(c => c.clientId === savedContactId);
        if (existing?.localId) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { localId: _id, ...contactUpdate } = contact;
          await db.contacts.update(existing.localId, contactUpdate);
        }
      } else {
        await db.contacts.add(contact);
      }
      await addToOutbox(clientId, deviceId, 'contact', contact);
      // Save documents
      for (const doc of (finalForm.documents || [])) {
        const exists = (await db.contactDocuments.toArray()).some(d => d.clientId === doc.id);
        if (!exists) {
          const localDoc: LocalContactDocument = {
            clientId: doc.id, deviceId, contactId: clientId, agentId,
            dataUri: doc.dataUri, mimeType: doc.mimeType,
            label: doc.label.trim() || undefined,
            exifLat: doc.exifLat, exifLng: doc.exifLng, exifCapturedAt: doc.exifCapturedAt,
            createdAt: now,
          };
          await db.contactDocuments.add(localDoc);
          await addToOutbox(localDoc.clientId, deviceId, 'contact_document', localDoc);
        }
      }
      try { await db.drafts.delete(DRAFT_KEY); } catch {}
      setSaving(false);
      return clientId;
    } catch {
      setError(t.errSaveContact);
      setSaving(false);
      return null;
    }
  }

  // Step 1 submit → quick save, then go to step 2
  async function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.errNameRequired); return; }
    if (!form.role) { setError(t.errContactType); return; }
    if (!form.panchayatId) { setError(t.errPanchayat); return; }
    const id = await saveContact(form);
    if (id) {
      setSavedContactId(id);
      setStep(2);
      setError('');
    }
  }

  // Step 2 final save → show survey
  async function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault();
    const id = await saveContact(form);
    if (id) setShowSurvey(true);
  }

  // Skip step 2 entirely → show survey
  function handleSkipDetails() {
    setShowSurvey(true);
  }

  if (showSurvey && savedContactId) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
        <SurveyClient contactId={savedContactId} onClose={() => router.push('/contacts')} />
      </div>
    );
  }

  if (isLoadingDraft) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)' }}>
        Loading Draft...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => step === 2 ? setStep(1) : router.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, minHeight: 40 }}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1>{step === 1 ? t.newContact : 'Add Details'}</h1>
        </div>
      </div>

      {draftRestored && step === 1 && (
        <div style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '1.5px solid #f59e0b', color: '#92400e', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span>📝 Draft restored — your last entry was saved automatically.</span>
          <button
            type="button"
            onClick={async () => { await db.drafts.delete(DRAFT_KEY); setForm(emptyForm(activeVisit?.panchayatId ?? '')); setDraftRestored(false); }}
            style={{ background: 'rgba(0,0,0,0.1)', border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, color: '#78350f', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Discard
          </button>
        </div>
      )}

      <StepIndicator step={step} />

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.form
            key="step1"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onSubmit={handleStep1Submit}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            {/* Contact Type */}
            <div>
              <p className="field-label" style={{ marginBottom: '0.5rem' }}>{t.contactType} <span style={{ color: 'var(--color-danger)' }}>*</span></p>
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
                      cursor: 'pointer', textAlign: 'left', transition: 'all 120ms ease',
                      minHeight: 52,
                    }}
                  >
                    <div style={{ fontSize: '1.25rem', marginBottom: '0.2rem' }}>{r.emoji}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
                  </button>
                ))}
              </div>
              {form.role === 'prominent_person' && (
                <div className="field-group" style={{ marginTop: '0.5rem' }}>
                  <label className="field-label" htmlFor="contact-profession">What is their profession?</label>
                  <input id="contact-profession" className="field-input" type="text" placeholder="e.g. Teacher, Shop Owner" value={form.profession} onChange={(e) => update('profession', e.target.value)} maxLength={80} style={{ minHeight: 52 }} />
                </div>
              )}
            </div>

            {/* Name */}
            <div className="field-group">
              <label className="field-label" htmlFor="contact-name">{t.fullName} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
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
                style={{ minHeight: 52, fontSize: '1rem' }}
              />
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
                value={form.phone}
                onChange={(e) => update('phone', e.target.value.replace(/\D/g, ''))}
                autoComplete="tel"
                style={{ minHeight: 52, fontSize: '1rem' }}
              />
            </div>

            {/* Panchayat — searchable */}
            <div className="field-group">
              <label className="field-label" htmlFor="panchayat-search">{t.panchayatLabel} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  id="panchayat-search"
                  className="field-input"
                  type="text"
                  placeholder="Search panchayat…"
                  value={showPanchayatList ? panchayatSearch : selectedPanchayatName}
                  onChange={(e) => { setPanchayatSearch(e.target.value); setShowPanchayatList(true); }}
                  onFocus={() => { setPanchayatSearch(''); setShowPanchayatList(true); }}
                  onBlur={() => setTimeout(() => setShowPanchayatList(false), 180)}
                  autoComplete="off"
                  style={{ minHeight: 52, fontSize: '1rem', paddingRight: form.panchayatId ? '2.5rem' : undefined }}
                />
                {form.panchayatId && !showPanchayatList && (
                  <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#10b981', fontSize: '1.1rem' }}>✓</span>
                )}
                {showPanchayatList && filteredPanchayats.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                    background: 'white', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto', marginTop: 4,
                  }}>
                    {filteredPanchayats.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => { update('panchayatId', p.id); setShowPanchayatList(false); setPanchayatSearch(''); }}
                        style={{
                          width: '100%', padding: '0.65rem 0.9rem', background: p.id === form.panchayatId ? 'rgba(99,102,241,0.08)' : 'transparent',
                          border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          borderBottom: '1px solid var(--surface-border)',
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.block}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <AddMissingPanchayatButton deviceId={deviceId} position={position} panchayats={panchayats} onAdded={(p) => update('panchayatId', p.id)} />
              </div>
            </div>

            {/* Photo — prominent one-tap button */}
            <div className="field-group">
              <label className="field-label">{t.capturePhoto}</label>
              <input id="contact-photo" type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} style={{ display: 'none' }} />
              <label
                htmlFor="contact-photo"
                style={{
                  width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  background: form.photoDataUri ? 'rgba(16,185,129,0.08)' : 'var(--surface-input)',
                  border: '1.5px dashed', borderColor: form.photoDataUri ? '#10b981' : 'var(--surface-border)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600,
                  color: form.photoDataUri ? '#10b981' : 'var(--text-secondary)', fontSize: '0.95rem',
                }}
              >
                {form.photoDataUri ? (
                  <>
                    <img src={form.photoDataUri} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                    📸 Photo attached — tap to retake
                  </>
                ) : (<>📷 {t.btnTakePhoto}</>)}
              </label>
            </div>

            {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>}

            <button
              id="save-contact-btn"
              type="submit"
              className="btn btn-primary btn-full btn-lg"
              disabled={saving}
              style={{ minHeight: 56, fontSize: '1rem' }}
            >
              {saving ? t.saving : '✓ Save & Add Details →'}
            </button>
          </motion.form>
        ) : (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {/* Step 2 saved banner */}
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.2rem' }}>✅</span>
              <div>
                <div style={{ fontWeight: 700, color: '#065f46', fontSize: '0.9rem' }}>Contact saved!</div>
                <div style={{ fontSize: '0.78rem', color: '#047857' }}>Add optional details below, or skip to survey.</div>
              </div>
            </div>

            <form onSubmit={handleStep2Submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="toggle-row" role="checkbox" aria-checked={form.whatsappAdded} tabIndex={0}
                  onClick={() => update('whatsappAdded', !form.whatsappAdded)}
                  onKeyDown={(e) => e.key === 'Enter' && update('whatsappAdded', !form.whatsappAdded)}
                  id="whatsapp-toggle" style={{ minHeight: 52 }}
                >
                  <span className="toggle-label">{t.addedToWhatsapp}</span>
                  <div className={`toggle-switch${form.whatsappAdded ? ' on' : ''}`} />
                </div>
                <div className="toggle-row" role="checkbox" aria-checked={form.cardGiven} tabIndex={0}
                  onClick={() => update('cardGiven', !form.cardGiven)}
                  onKeyDown={(e) => e.key === 'Enter' && update('cardGiven', !form.cardGiven)}
                  id="card-toggle" style={{ minHeight: 52 }}
                >
                  <span className="toggle-label">{t.partnerCardGiven}</span>
                  <div className={`toggle-switch${form.cardGiven ? ' on' : ''}`} />
                </div>
                <div className="toggle-row" role="checkbox" aria-checked={form.agentEscalated} tabIndex={0}
                  onClick={() => update('agentEscalated', !form.agentEscalated)}
                  onKeyDown={(e) => e.key === 'Enter' && update('agentEscalated', !form.agentEscalated)}
                  id="escalate-toggle" style={{ minHeight: 52, background: form.agentEscalated ? '#fef2f2' : 'transparent', border: form.agentEscalated ? '1px solid #fecaca' : '' }}
                >
                  <span className="toggle-label" style={{ color: form.agentEscalated ? '#b91c1c' : 'inherit', fontWeight: form.agentEscalated ? 600 : 400 }}>🚨 Escalate to Admin</span>
                  <div className={`toggle-switch${form.agentEscalated ? ' on' : ''}`} />
                </div>
                {form.agentEscalated && (
                  <div className="field-group" style={{ marginTop: '0.25rem' }}>
                    <label className="field-label" htmlFor="contact-escalation-note" style={{ color: '#b91c1c' }}>Escalation Reason</label>
                    <textarea id="contact-escalation-note" className="field-input" placeholder="Why does admin need to contact on priority?" value={form.agentEscalationNote} onChange={(e) => update('agentEscalationNote', e.target.value)} rows={2} style={{ borderColor: '#fecaca', background: '#fef2f2' }} />
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="field-group">
                <label className="field-label" htmlFor="contact-notes">{t.notesLabel}</label>
                <textarea id="contact-notes" className="field-input" placeholder={t.notesPlaceholder} value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={3} />
              </div>

              {/* Complaints & Conflicts */}
              <div className="field-group">
                <label className="field-label" htmlFor="contact-complaints" style={{ color: 'var(--color-danger)' }}>Issues / Complaints</label>
                <textarea id="contact-complaints" className="field-input" placeholder="Record any issues..." value={form.complaints} onChange={(e) => update('complaints', e.target.value)} rows={2} style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#7f1d1d' }} />
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="contact-conflicts" style={{ color: '#ea580c' }}>Conflicts</label>
                <textarea id="contact-conflicts" className="field-input" placeholder="Record any conflicts..." value={form.conflicts} onChange={(e) => update('conflicts', e.target.value)} rows={2} style={{ borderColor: '#fed7aa', background: '#fff7ed', color: '#9a3412' }} />
              </div>

              {/* CRM Details */}
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b' }}>{t.crmDetails}</h3>
                <div className="field-group">
                  <label className="field-label" htmlFor="contact-status">{t.leadStatus}</label>
                  <select id="contact-status" className="field-input" value={form.status} onChange={(e) => update('status', e.target.value as any)}>
                    <option value="Lead">{t.statusLead}</option>
                    <option value="Contacted">{t.statusContacted}</option>
                    <option value="Interested">{t.statusInterested}</option>
                    <option value="Converted">{t.statusConverted}</option>
                    <option value="Rejected">{t.statusRejected}</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="contact-followup">{t.followUpDate}</label>
                  <input id="contact-followup" className="field-input" type="date" value={form.followUpDate} onChange={(e) => update('followUpDate', e.target.value)} />
                </div>
              </div>

              {/* Documents */}
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b' }}>Documents</h3>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {/* Camera capture — opens camera directly on mobile */}
                    <label htmlFor="contact-doc-camera" style={{ padding: '0.4rem 0.75rem', background: 'white', border: '1px solid #10b981', color: '#10b981', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      📷 Camera
                    </label>
                    <input id="contact-doc-camera" type="file" accept="image/*" capture="environment" onChange={handleDocumentUpload} style={{ display: 'none' }} />
                    {/* File picker — opens gallery/files */}
                    <label htmlFor="contact-doc" style={{ padding: '0.4rem 0.75rem', background: 'white', border: '1px solid var(--color-primary-300)', color: 'var(--color-primary-600)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      📁 File
                    </label>
                    <input id="contact-doc" type="file" accept="image/*,.pdf" onChange={handleDocumentUpload} style={{ display: 'none' }} />
                  </div>
                </div>
                {form.documents.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem' }}>No documents attached.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {form.documents.map((doc, idx) => (
                      <div key={doc.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'white', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {doc.mimeType.includes('image') && doc.dataUri ? (
                            <img src={doc.dataUri} alt="Preview" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                          ) : (<div style={{ fontSize: '1.5rem', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{doc.mimeType.includes('pdf') ? '📄' : '🖼️'}</div>)}
                          <input type="text" placeholder="Label (e.g. Aadhaar Card)" value={doc.label} onChange={(e) => { const nd = [...form.documents]; nd[idx].label = e.target.value; update('documents', nd); }} style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '0.9rem', outline: 'none', fontWeight: 600 }} />
                          <button type="button" onClick={() => update('documents', form.documents.filter(d => d.id !== doc.id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', paddingBottom: '0.25rem', scrollbarWidth: 'none' }}>
                          {['Aadhaar Card', 'Visiting Card', 'Prescription', 'Shop Board', 'Clinic Photo'].map(label => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => { const nd = [...form.documents]; nd[idx].label = label; update('documents', nd); }}
                              style={{ whiteSpace: 'nowrap', padding: '0.2rem 0.5rem', borderRadius: '12px', border: '1px solid #cbd5e1', background: doc.label === label ? '#e0e7ff' : '#f1f5f9', color: doc.label === label ? '#4f46e5' : '#475569', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={handleSkipDetails}
                  style={{ flex: 1, minHeight: 52, background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', color: 'var(--text-secondary)' }}
                >
                  Skip →
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                  style={{ flex: 2, minHeight: 52, fontSize: '0.95rem' }}
                >
                  {saving ? t.saving : '✓ Save & Take Survey'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
