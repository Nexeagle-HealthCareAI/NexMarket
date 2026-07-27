'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { usePanchayats, useActiveVisit, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import type { ContactRole, LocalContact } from '@/lib/db/schema';

const ROLES: { value: ContactRole; label: string; emoji: string; desc: string }[] = [
  { value: 'asha_worker',    label: 'Channel Partner', emoji: '🤝', desc: 'Local channel & distribution partner' },
  { value: 'rmp_doctor',     label: 'Key Account',     emoji: '🏢', desc: 'Verified retail business or merchant' },
  { value: 'ward_member',    label: 'Local Rep',       emoji: '🏛️', desc: 'Local community representative' },
  { value: 'medicine_shop',  label: 'Retail Outlet',   emoji: '🏪', desc: 'Local business store / outlet' },
];

export default function NewContactPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeShiftClientId = useAgentStore((s) => s.activeShiftClientId);

  const panchayats = usePanchayats();
  const activeVisit = useActiveVisit(agentId ?? undefined);

  const [form, setForm] = useState({
    name: '',
    role: '' as ContactRole | '',
    panchayatId: activeVisit?.panchayatId ?? '',
    phone: '',
    whatsappAdded: false,
    cardGiven: false,
    notes: '',
    status: 'Lead' as 'Lead' | 'Contacted' | 'Interested' | 'Converted' | 'Rejected',
    followUpDate: '',
    photoDataUri: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        update('photoDataUri', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.role) { setError('Select a contact type'); return; }
    if (!form.panchayatId) { setError('Select a panchayat'); return; }
    if (!agentId || !deviceId) { setError('Not logged in'); return; }

    setSaving(true);
    setError('');

    const now = new Date().toISOString();
    const clientId = uuidv4();

    const contact: LocalContact = {
      clientId,
      deviceId,
      agentId,
      panchayatId: form.panchayatId,
      name: form.name.trim(),
      role: form.role as ContactRole,
      phone: form.phone.trim() || undefined,
      whatsappAdded: form.whatsappAdded,
      cardGiven: form.cardGiven,
      notes: form.notes.trim() || undefined,
      status: form.status,
      followUpDate: form.followUpDate || undefined,
      photoDataUri: form.photoDataUri || undefined,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.contacts.add(contact);
      await addToOutbox(clientId, deviceId, 'contact', contact);
      router.push('/contacts');
    } catch (err) {
      setError('Failed to save contact. Please try again.');
      setSaving(false);
    }
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
          <h1>New Contact</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Contact Type */}
        <div>
          <p className="field-label" style={{ marginBottom: '0.5rem' }}>Contact Type *</p>
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
          <label className="field-label" htmlFor="contact-name">Full Name *</label>
          <input
            id="contact-name"
            className="field-input"
            type="text"
            placeholder="e.g. Sunita Devi"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            autoComplete="name"
            required
            minLength={2}
            maxLength={50}
            pattern="^[A-Za-z\s]+$"
            title="Name must contain only letters and spaces"
          />
        </div>

        {/* Panchayat */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-panchayat">Panchayat *</label>
          <select
            id="contact-panchayat"
            className="field-input"
            value={form.panchayatId}
            onChange={(e) => update('panchayatId', e.target.value)}
            required
          >
            <option value="">Select panchayat…</option>
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
          <label className="field-label" htmlFor="contact-phone">Mobile Number (optional)</label>
          <input
            id="contact-phone"
            className="field-input"
            type="tel"
            inputMode="numeric"
            placeholder="10-digit number"
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
            <span className="toggle-label">Added to WhatsApp Group</span>
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
            <span className="toggle-label">Partner Card Given</span>
            <div className={`toggle-switch${form.cardGiven ? ' on' : ''}`} />
          </div>
        </div>

        {/* Notes */}
        <div className="field-group">
          <label className="field-label" htmlFor="contact-notes">Notes (optional)</label>
          <textarea
            id="contact-notes"
            className="field-input"
            placeholder="Any relevant details…"
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={3}
          />
        </div>

        {/* CRM Workflows: Lead Status, Follow-up, Photo */}
        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b' }}>CRM Details</h3>
          
          <div className="field-group">
            <label className="field-label" htmlFor="contact-status">Lead Status</label>
            <select
              id="contact-status"
              className="field-input"
              value={form.status}
              onChange={(e) => update('status', e.target.value as any)}
            >
              <option value="Lead">Lead (Initial)</option>
              <option value="Contacted">Contacted</option>
              <option value="Interested">Interested</option>
              <option value="Converted">Converted</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="contact-followup">Follow-up Date (optional)</label>
            <input
              id="contact-followup"
              className="field-input"
              type="date"
              value={form.followUpDate}
              onChange={(e) => update('followUpDate', e.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="contact-photo">Capture Photo (Offline Sync)</label>
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
                📸 Take Photo
              </button>
              {form.photoDataUri && <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>✓ Photo attached</span>}
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
          {saving ? 'Saving…' : '💾 Save Contact'}
        </button>
      </form>
    </div>
  );
}
