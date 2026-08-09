'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAgentStore } from '@/store/agent-store';
import { getAgentDetail, updateAgentProfile, type AgentDetailDto, type UpdateAgentProfileRequest } from '@/lib/sync/api-client';

const STATUS_LABEL: Record<AgentDetailDto['status'], string> = {
  online: '🟢 Online',
  'low-connectivity': '🟡 Low Signal',
  offline: '⚪ Offline',
};

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const viewerAgentId = useAgentStore((s) => s.agentId);
  // Supports the "Edit" quick-action on the agents list, which links here
  // with ?edit=1 to land straight in edit mode instead of an extra click.
  const searchParams = useSearchParams();

  const [agent, setAgent] = useState<AgentDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<UpdateAgentProfileRequest>({});

  const load = () => {
    if (!viewerAgentId) return;
    setLoading(true);
    setError('');
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
          role: data.role,
          district: data.district,
          block: data.block,
          isActive: data.isActive,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agent.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [viewerAgentId, agentId]);

  const handleSave = async () => {
    if (!viewerAgentId) return;
    setSaving(true);
    setError('');
    try {
      await updateAgentProfile(agentId, form);
      setIsEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading agent…</div>;
  }

  if (error && !agent) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-danger)' }}>{error}</div>;
  }

  if (!agent) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-danger)' }}>Agent not found.</div>;
  }

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>{value || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not provided</span>}</div>
    </div>
  );

  const editInput = (key: keyof UpdateAgentProfileRequest, type = 'text') => (
    <input
      type={type}
      className="field-input"
      value={(form[key] as string) ?? ''}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
    />
  );

  return (
    <div style={{ paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <Link href="/admin/agents" className="btn btn-ghost btn-sm">← Back</Link>
        <div style={{ flex: 1 }} />
        {isEditing ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => { setIsEditing(false); load(); }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary btn-sm" style={{ background: 'var(--color-primary-600)' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" style={{ background: 'var(--color-primary-600)' }} onClick={() => setIsEditing(true)}>✏️ Edit</button>
        )}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {/* Header card */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {agent.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.photoUrl} alt={agent.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-muted)' }}>{agent.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{agent.name}</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {agent.agentId} · {agent.role} · {agent.district}, {agent.block}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>{STATUS_LABEL[agent.status]}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {agent.lastSeenAt ? `Last seen ${new Date(agent.lastSeenAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'No GPS data yet'}
          </div>
          {agent.lastSeenLat != null && (
            <Link href={`/admin/map?agentId=${encodeURIComponent(agent.agentId)}`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>📍 View on Map</Link>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Identity */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Identity</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                {editInput('firstName')}
                {editInput('middleName')}
                {editInput('lastName')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {editInput('dateOfBirth', 'date')}
                <select className="field-input" value={form.gender ?? ''} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
                  <option value="">Select…</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {field('Date of Birth', agent.dateOfBirth ? new Date(agent.dateOfBirth).toLocaleDateString('en-GB') : null)}
              {field('Age', agent.age)}
              {field('Sex', agent.gender)}
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Contact</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {field('Phone (fixed)', `+91 ${agent.phone}`)}
              {editInput('email', 'email')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {field('Phone', `+91 ${agent.phone}`)}
              {field('Email', agent.email)}
            </div>
          )}
        </div>

        {/* Address */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Address</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <textarea className="field-input" rows={2} value={form.address ?? ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Address" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <select className="field-input" value={form.district ?? ''} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}>
                  {['Katihar', 'Purnia', 'Araria', 'Supaul', 'Uttar Dinajpur'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {editInput('block')}
                {editInput('pincode')}
              </div>
            </div>
          ) : (
            field('Full Address', agent.fullAddress)
          )}
        </div>

        {/* Background */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Background</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {editInput('education')}
              {editInput('workExperience')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {field('Education Qualification', agent.education)}
              {field('Prior Work Experience', agent.workExperience)}
            </div>
          )}
        </div>

        {/* Emergency Contact */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Emergency Contact</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {editInput('emergencyContactName')}
              {editInput('emergencyContactPhone', 'tel')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {field('Contact Person Name', agent.emergencyContactName)}
              {field('Contact Number', agent.emergencyContactPhone)}
            </div>
          )}
        </div>

        {/* Account */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Account</h2>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <select className="field-input" value={form.role ?? ''} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="Marketing Executive">Marketing Executive</option>
                <option value="Field Officer">Field Officer</option>
                <option value="Regional Representative">Regional Representative</option>
                <option value="Admin">Admin</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={form.isActive ?? true} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Active
              </label>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {field('Status', agent.isActive ? '✅ Active' : '🚫 Deactivated')}
              {field('Must Change Password', agent.mustChangePassword ? 'Yes' : 'No')}
              {field('Onboarded', new Date(agent.createdAt).toLocaleDateString('en-GB'))}
              {field('Profile Completed', agent.profileCompleted ? 'Yes' : 'No')}
            </div>
          )}
        </div>
      </div>

      {agent.personalDetails && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>About</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{agent.personalDetails}</p>
        </div>
      )}
    </div>
  );
}
