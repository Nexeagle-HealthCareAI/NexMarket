'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getAgentDetail, updateAgentProfile, uploadPhoto, type AgentDetailDto, type UpdateAgentProfileRequest } from '@/lib/sync/api-client';
import { compressImageToBlob } from '@/lib/image/compressImage';

export default function ProfilePage() {
  const agentId = useAgentStore((s) => s.agentId);

  const [agent, setAgent] = useState<AgentDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<UpdateAgentProfileRequest>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    getAgentDetail(agentId)
      .then((data) => {
        setAgent(data);
        setForm({
          firstName: data.firstName ?? undefined,
          middleName: data.middleName ?? undefined,
          lastName: data.lastName ?? undefined,
          email: data.email ?? undefined,
          dateOfBirth: data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : undefined,
          gender: data.gender ?? undefined,
          address: data.address ?? undefined,
          pincode: data.pincode ?? undefined,
          education: data.education ?? undefined,
          workExperience: data.workExperience ?? undefined,
          emergencyContactName: data.emergencyContactName ?? undefined,
          emergencyContactPhone: data.emergencyContactPhone ?? undefined,
          personalDetails: data.personalDetails ?? undefined,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load your profile.'))
      .finally(() => setLoading(false));
  }, [agentId]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!agentId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let photoUrl: string | undefined;
      if (photoFile) {
        const uploaded = await uploadPhoto(await compressImageToBlob(photoFile), 'profile.jpg');
        photoUrl = uploaded.url;
      }
      await updateAgentProfile(agentId, { ...form, photoUrl });
      setSuccess('Profile updated.');
      setPhotoFile(null);
      const refreshed = await getAgentDetail(agentId);
      setAgent(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof UpdateAgentProfileRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading your profile…</div>;
  }

  if (!agent) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-danger)' }}>{error || 'Profile not found.'}</div>;
  }

  return (
    <div style={{ paddingBottom: '3rem', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>My Profile</h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {agent.agentId} · {agent.role} · {agent.district}, {agent.block}
      </p>

      {error && (
        <div className="card" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}
      {success && (
        <div className="card" style={{ marginBottom: '1.25rem', borderLeft: '4px solid #10b981', background: 'rgba(16,185,129,0.05)' }}>
          <p style={{ color: '#10b981', fontSize: '0.85rem' }}>{success}</p>
        </div>
      )}

      {/* Photo */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-input)', border: '2px dashed var(--surface-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          {photoPreview || agent.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview || agent.photoUrl!} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: '1.5rem' }}>📷</span>
          )}
        </div>
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
            {agent.photoUrl || photoPreview ? 'Change Photo' : 'Add Photo'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Identity */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Identity</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">First Name</label>
            <input type="text" className="field-input" value={form.firstName ?? ''} onChange={set('firstName')} />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Middle Name</label>
            <input type="text" className="field-input" value={form.middleName ?? ''} onChange={set('middleName')} />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Last Name</label>
            <input type="text" className="field-input" value={form.lastName ?? ''} onChange={set('lastName')} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Date of Birth</label>
            <input type="date" className="field-input" value={form.dateOfBirth ?? ''} onChange={set('dateOfBirth')} />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Sex</label>
            <select className="field-input" value={form.gender ?? ''} onChange={set('gender')}>
              <option value="">Select…</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Contact</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Phone</label>
            <input type="tel" className="field-input" value={`+91 ${agent.phone}`} disabled />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Email</label>
            <input type="email" className="field-input" value={form.email ?? ''} onChange={set('email')} />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Address</h2>
        <div className="field-group" style={{ margin: '0 0 0.75rem' }}>
          <label className="field-label">Address</label>
          <textarea className="field-input" rows={2} value={form.address ?? ''} onChange={set('address')} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Block / District</label>
            <input type="text" className="field-input" value={`${agent.block}, ${agent.district}`} disabled />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Pincode</label>
            <input type="text" className="field-input" value={form.pincode ?? ''} onChange={set('pincode')} maxLength={10} />
          </div>
        </div>
      </div>

      {/* Background */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Background</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Education Qualification</label>
            <input type="text" className="field-input" value={form.education ?? ''} onChange={set('education')} />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Prior Work Experience</label>
            <input type="text" className="field-input" value={form.workExperience ?? ''} onChange={set('workExperience')} />
          </div>
        </div>
        <div className="field-group" style={{ margin: 0 }}>
          <label className="field-label">About Me</label>
          <textarea className="field-input" rows={3} value={form.personalDetails ?? ''} onChange={set('personalDetails')} />
        </div>
      </div>

      {/* Emergency Contact */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Emergency Contact</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Contact Person Name</label>
            <input type="text" className="field-input" value={form.emergencyContactName ?? ''} onChange={set('emergencyContactName')} />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Contact Number</label>
            <input type="tel" className="field-input" value={form.emergencyContactPhone ?? ''} onChange={set('emergencyContactPhone')} maxLength={10} />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-full"
        style={{ background: 'var(--color-primary-600)' }}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}
