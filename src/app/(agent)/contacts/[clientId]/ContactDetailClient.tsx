'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { useContact, usePanchayats, useReferrals, useActiveVisit, db, useContactDocuments } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { compressImage, compressDocumentImage } from '@/lib/image/compressImage';
import type { ReferralStatus, LocalReferral, ContactRole, LocalContactDocument } from '@/lib/db/schema';

const STATUS_LABELS: Record<ReferralStatus, { label: string; badgeClass: string; icon: string }> = {
  pending: { label: 'Pending Review', badgeClass: 'badge-pending', icon: '⏳' },
  converted: { label: 'Converted (Active Client Onboarded)', badgeClass: 'badge-online', icon: '✅' },
  lost: { label: 'Lost to Competitor / Inactive', badgeClass: 'badge-dup', icon: '❌' },
};

export default function ContactDetailClient({ clientId }: { clientId: string }) {
  const router = useRouter();
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeVisitClientId = useAgentStore((s) => s.activeVisitClientId);

  const contact = useContact(clientId);
  const documents = useContactDocuments(clientId);
  const panchayats = usePanchayats();
  const referrals = useReferrals(clientId);
  const agentId = useAgentStore((s) => s.agentId);

  const [showReferralForm, setShowReferralForm] = useState(false);
  const [status, setStatus] = useState<ReferralStatus>('pending');
  const [referralDate, setReferralDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // CRM Status Editing
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState<'Lead' | 'Contacted' | 'Interested' | 'Converted' | 'Rejected'>('Lead');

  // Basic Profile Editing
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<ContactRole>('asha_worker');
  const [editAgentEscalated, setEditAgentEscalated] = useState(false);
  const [editAgentEscalationNote, setEditAgentEscalationNote] = useState('');

  function startEditingProfile() {
    if (!contact) return;
    setEditName(contact.name);
    setEditPhone(contact.phone || '');
    setEditRole(contact.role);
    setEditAgentEscalated(contact.agentEscalated || false);
    setEditAgentEscalationNote(contact.agentEscalationNote || '');
    setIsEditingProfile(true);
  }

  async function handleSaveProfile() {
    if (!contact || !deviceId) return;
    try {
      const updatedData = { 
        name: editName.trim(), 
        phone: editPhone.trim() || undefined, 
        role: editRole, 
        agentEscalated: editAgentEscalated,
        agentEscalationNote: editAgentEscalationNote.trim() || undefined,
        updatedAt: new Date().toISOString() 
      };
      await db.contacts.update(contact.localId!, updatedData);
      await addToOutbox(contact.clientId, deviceId, 'contact', { ...contact, ...updatedData });
      setIsEditingProfile(false);
    } catch {
      alert('Failed to update profile');
    }
  }

  const panchayat = useMemo(() => {
    return panchayats?.find((p) => p.id === contact?.panchayatId);
  }, [panchayats, contact]);

  async function handleAddReferral(e: React.FormEvent) {
    e.preventDefault();
    if (!contact || !deviceId) return;

    setSaving(true);
    setError('');

    const refClientId = uuidv4();
    const now = new Date().toISOString();

    const newReferral: LocalReferral = {
      clientId: refClientId,
      deviceId,
      contactId: contact.clientId,
      visitId: activeVisitClientId ?? undefined,
      referralDate,
      status,
      notes: notes.trim() || undefined,
      clientPhone: refPhone.trim() || undefined,
      createdAt: now,
    };

    try {
      await db.referrals.add(newReferral);
      await addToOutbox(refClientId, deviceId, 'referral', newReferral);
      setShowReferralForm(false);
      setNotes('');
      setRefPhone('');
      setStatus('pending');
    } catch {
      setError('Failed to save referral outcome. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStatus() {
    if (!contact) return;
    try {
      await db.contacts.update(contact.localId!, { status: newStatus, updatedAt: new Date().toISOString() });
      await addToOutbox(contact.clientId, deviceId!, 'contact', { ...contact, status: newStatus, updatedAt: new Date().toISOString() });
      setIsEditingStatus(false);
    } catch {
      alert('Failed to update status');
    }
  }

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !contact || !deviceId || !agentId) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Document size must be less than 5MB');
      return;
    }
    try {
      let dataUri: string;
      let exifLat: number | null = null;
      let exifLng: number | null = null;
      let exifCapturedAt: string | null = null;

      if (file.type.startsWith('image/')) {
        const compressed = await compressDocumentImage(file);
        dataUri = compressed.dataUri;
        exifLat = compressed.exifLat;
        exifLng = compressed.exifLng;
        exifCapturedAt = compressed.exifCapturedAt;
      } else {
        const { fileToBase64 } = await import('@/lib/image/fileToBase64');
        dataUri = await fileToBase64(file);
      }
      const localDoc: LocalContactDocument = {
        clientId: uuidv4(),
        deviceId,
        contactId: contact.clientId,
        agentId,
        dataUri,
        mimeType: file.type || 'application/octet-stream',
        label: file.name, // Use filename as default label if uploaded post-creation
        exifLat,
        exifLng,
        exifCapturedAt,
        createdAt: new Date().toISOString(),
      };
      await db.contactDocuments.add(localDoc);
      await addToOutbox(localDoc.clientId, deviceId, 'contact_document', localDoc);
    } catch {
      alert('Failed to attach document');
    }
  };

  if (!contact) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="empty-state-icon">👤</div>
        <h2>Contact not found</h2>
        <p style={{ fontSize: '0.85rem' }}>This contact record does not exist or was deleted.</p>
        <button className="btn btn-primary" onClick={() => router.push('/contacts')} style={{ marginTop: '0.5rem' }}>
          Back to Contacts
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, minHeight: 40 }}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1>Contact Profile</h1>
        </div>
      </div>

      {/* Contact Main Card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        {isEditingProfile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <input value={editName} onChange={e => setEditName(e.target.value)} className="field-input" placeholder="Name" />
            <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="field-input" placeholder="Phone (10 digits)" type="tel" maxLength={10} />
            <select value={editRole} onChange={e => setEditRole(e.target.value as any)} className="field-input">
              <option value="asha_worker">ASHA Worker</option>
              <option value="rmp_doctor">RMP Doctor</option>
              <option value="ward_member">Ward Member</option>
              <option value="medicine_shop">Medicine Shop</option>
              <option value="mukhiya">Mukhiya</option>
              <option value="prominent_person">Prominent Person</option>
              <option value="lab">Lab/Pathology</option>
              <option value="nursing_home">Nursing Home</option>
              <option value="independent_doctor">Independent Doctor</option>
              <option value="hospital">Hospital</option>
              <option value="other">Other</option>
            </select>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#b91c1c', fontWeight: editAgentEscalated ? 600 : 400 }}>
                <input 
                  type="checkbox" 
                  checked={editAgentEscalated} 
                  onChange={e => setEditAgentEscalated(e.target.checked)} 
                />
                🚨 Escalate to Admin on Priority
              </label>
              {editAgentEscalated && (
                <textarea 
                  className="field-input"
                  placeholder="Escalation Notes / Reason" 
                  value={editAgentEscalationNote} 
                  onChange={e => setEditAgentEscalationNote(e.target.value)} 
                  rows={2}
                  style={{ borderColor: '#fecaca', background: '#fef2f2', marginTop: '0.25rem' }}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button onClick={handleSaveProfile} className="btn btn-primary" style={{ flex: 1, padding: '0.5rem' }}>Save</button>
              <button onClick={() => setIsEditingProfile(false)} className="btn btn-ghost" style={{ flex: 1, padding: '0.5rem' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                <h2 style={{ fontSize: '1.3rem', color: 'var(--text-primary)', margin: 0 }}>{contact.name}</h2>
                <button onClick={startEditingProfile} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}>✏️</button>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                📍 {panchayat ? `${panchayat.name} (${panchayat.block})` : 'Panchayat loading…'}
              </p>
              {contact.phone && (
                <p style={{ fontSize: '0.9rem', color: 'var(--color-primary-400)', fontWeight: 600, marginTop: '0.35rem' }}>
                  📞 <a href={`tel:${contact.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>+91 {contact.phone}</a>
                </p>
              )}
            </div>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
              <span className="badge" style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--color-primary-400)', fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
                {contact.role.replace('_', ' ').toUpperCase()}
              </span>
              {contact.profession && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{contact.profession}</span>
              )}
            </span>
          </div>
        )}

        {/* CRM DETAILS (Photo, Status, Follow-up) */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          {contact.photoDataUri ? (
            <img 
              src={contact.photoDataUri} 
              alt="Contact Photo" 
              style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '8px', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} 
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: '8px', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
              👤
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</div>
              {isEditingStatus ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select 
                    value={newStatus} 
                    onChange={e => setNewStatus(e.target.value as any)}
                    style={{ padding: '0.2rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="Lead">Lead</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Interested">Interested</option>
                    <option value="Converted">Converted</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                  <button onClick={handleUpdateStatus} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '0 0.5rem', cursor: 'pointer' }}>✓</button>
                  <button onClick={() => setIsEditingStatus(false)} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '0 0.5rem', cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, color: '#334155' }}>{contact.status || 'Lead'}</span>
                  <button onClick={() => { setNewStatus(contact.status || 'Lead'); setIsEditingStatus(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}>✏️</button>
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Follow-up:</span>
              <span style={{ fontWeight: 600, color: contact.followUpDate ? '#0f172a' : '#94a3b8' }}>
                {contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-IN') : 'None Scheduled'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--surface-border)' }}>
          <span className={`badge ${contact.whatsappAdded ? 'badge-online' : 'badge-pending'}`}>
            {contact.whatsappAdded ? '🟢 WhatsApp Added' : '⚪ Not in WhatsApp Group'}
          </span>
          <span className={`badge ${contact.cardGiven ? 'badge-online' : 'badge-pending'}`}>
            {contact.cardGiven ? '🟢 Partner Card Given' : '⚪ No Partner Card'}
          </span>
          {contact.potentialDuplicateOf && contact.potentialDuplicateOf.length > 0 && (
            <span className="badge badge-dup">⚠️ Potential Duplicate</span>
          )}
          {contact.agentEscalated && (
            <span className="badge badge-dup" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
              🚨 Escalated to Admin
            </span>
          )}
        </div>

        {contact.agentEscalated && contact.agentEscalationNote && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: '#991b1b' }}>
            <strong>Escalation Reason:</strong> {contact.agentEscalationNote}
          </div>
        )}

        {contact.notes && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'var(--surface-bg)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <strong>Notes:</strong> {contact.notes}
          </div>
        )}

        {contact.complaints && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: '#7f1d1d' }}>
            <strong>Issues / Complaints:</strong> {contact.complaints}
          </div>
        )}

        {contact.conflicts && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: '#9a3412' }}>
            <strong>Conflicts:</strong> {contact.conflicts}
          </div>
        )}
      </div>

      {/* Documents */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Attached Documents ({documents?.length ?? 0})</h3>
        <input
          id="detail-contact-doc"
          type="file"
          accept="image/*,.pdf"
          onChange={handleDocumentUpload}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => document.getElementById('detail-contact-doc')?.click()}
          className="btn btn-sm"
          style={{ background: 'white', border: '1px solid var(--color-primary-300)', color: 'var(--color-primary-600)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          + Add Document
        </button>
      </div>

      {documents && documents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {documents.map(doc => (
            <div key={doc.clientId} className="card" style={{ padding: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {doc.mimeType.includes('image') && doc.dataUri ? (
                <img src={doc.dataUri} alt="Preview" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
              ) : (
                <div style={{ fontSize: '1.5rem', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {doc.mimeType.includes('pdf') ? '📄' : '🖼️'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {doc.label || 'Attached Document'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(doc.createdAt).toLocaleDateString()} • {doc.syncedAt ? 'Synced' : 'Pending Sync'}
                </div>
              </div>
              <a 
                href={doc.dataUri} 
                download={doc.label || 'document'} 
                style={{ background: 'var(--surface-bg)', color: 'var(--color-primary-600)', padding: '0.4rem 0.6rem', borderRadius: '4px', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600 }}
              >
                View
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Referrals Header & Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Client Referrals ({referrals?.length ?? 0})</h3>
        {!showReferralForm && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowReferralForm(true)}
            id="add-referral-btn"
          >
            + Add Referral Outcome
          </button>
        )}
      </div>

      {/* Inline Referral Form */}
      {showReferralForm && (
        <form onSubmit={handleAddReferral} className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--color-primary-500)', background: 'rgba(99,102,241,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>Log New Client Referral</h4>
            <button
              type="button"
              onClick={() => setShowReferralForm(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              ✕
            </button>
          </div>

          <div className="field-group" style={{ marginBottom: '0.75rem' }}>
            <label className="field-label" htmlFor="ref-status">Referral Outcome Status *</label>
            <select
              id="ref-status"
              className="field-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ReferralStatus)}
              required
            >
              <option value="pending">⏳ Pending Review (Client referred, not yet arrived)</option>
              <option value="converted">✅ Converted (Active Client Onboarded)</option>
              <option value="lost">❌ Lost (Declined / Inactive)</option>
            </select>
          </div>

          <div className="field-group" style={{ marginBottom: '0.75rem' }}>
            <label className="field-label" htmlFor="ref-date">Referral Date *</label>
            <input
              id="ref-date"
              className="field-input"
              type="date"
              value={referralDate}
              onChange={(e) => setReferralDate(e.target.value)}
              required
            />
          </div>

          <div className="field-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label" htmlFor="ref-notes">Client Name / Area / Notes</label>
            <textarea
              id="ref-notes"
              className="field-input"
              rows={2}
              placeholder="e.g. Ramesh Kumar, Cardiology consultation..."
              value={notes}
              maxLength={200}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="field-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label" htmlFor="ref-phone">Client Mobile Number</label>
            <input
              id="ref-phone"
              className="field-input"
              type="tel"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={refPhone}
              minLength={10}
              maxLength={10}
              pattern="^[0-9]{10}$"
              title="Mobile number must be exactly 10 digits"
              onChange={(e) => setRefPhone(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Referral'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowReferralForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Referrals List */}
      {!referrals || referrals.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem 1rem' }}>
          <div className="empty-state-icon" style={{ fontSize: '2rem' }}>🏢</div>
          <p style={{ fontSize: '0.85rem' }}>No client referrals logged from this contact yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {referrals.map((ref) => {
            const st = STATUS_LABELS[ref.status];
            return (
              <div key={ref.clientId} className="card" style={{ padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span className={`badge ${st.badgeClass}`}>
                    {st.icon} {st.label}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    📅 {new Date(ref.referralDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {ref.notes ? (
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: '0.35rem' }}>{ref.notes}</p>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.25rem' }}>No additional notes provided</p>
                )}
                {ref.clientPhone && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-primary-400)', fontWeight: 600, marginTop: '0.35rem' }}>
                    📞 <a href={`tel:${ref.clientPhone}`} style={{ color: 'inherit', textDecoration: 'none' }}>+91 {ref.clientPhone}</a>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
