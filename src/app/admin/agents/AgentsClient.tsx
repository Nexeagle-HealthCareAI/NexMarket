'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import { getAgents, onboardAgent, updateAgentProfile, uploadPhoto, getPanchayats, resetAgentPassword, type AdminAgentDto, type PanchayatDto } from '@/lib/sync/api-client';

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
function generatePassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

export default function AgentsClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const [agentsList, setAgentsList] = useState<AdminAgentDto[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'low-connectivity' | 'offline'>('all');
  const [showDeactivated, setShowDeactivated] = useState(false);

  // Remove/reactivate — "remove" deactivates (isActive: false) rather than
  // hard-deleting, since AgentId is referenced (as a plain string, no FK
  // cascade) by every contact/visit/shift/referral the officer ever logged —
  // deleting the row outright would orphan all of that historical data.
  const [removingAgent, setRemovingAgent] = useState<AdminAgentDto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const [resettingAgent, setResettingAgent] = useState<AdminAgentDto | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [newGeneratedPassword, setNewGeneratedPassword] = useState<string | null>(null);

  // Onboarding Drawer State
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [stepError, setStepError] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newMiddleName, setNewMiddleName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDistrict, setNewDistrict] = useState('Purnia');
  const [newBlock, setNewBlock] = useState('Kasba');
  const [newRole, setNewRole] = useState('Marketing Executive');
  const [newDob, setNewDob] = useState('');
  const [newGender, setNewGender] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPincode, setNewPincode] = useState('');
  const [newEducation, setNewEducation] = useState('');
  const [newWorkExperience, setNewWorkExperience] = useState('');
  const [newEmergencyName, setNewEmergencyName] = useState('');
  const [newEmergencyPhone, setNewEmergencyPhone] = useState('');
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState('');
  const [generatedCreds, setGeneratedCreds] = useState<{
    userId: string;
    pass: string;
    name: string;
    role: string;
    district: string;
    block: string;
  } | null>(null);

  const loadAgents = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getAgents();
      setAgentsList(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadAgents();
    getPanchayats().then(setPanchayats).catch(console.error);
    // Live-ish refresh — cheap poll rather than a full presence/WebSocket system.
    const timer = setInterval(() => void loadAgents(), 30_000);
    return () => clearInterval(timer);
  }, [loadAgents]);

  const uniqueDistricts = useMemo(() => {
    const d = Array.from(new Set(panchayats.map(p => p.district))).sort();
    return d.length > 0 ? d : ['Katihar', 'Purnia', 'Araria', 'Kishanganj', 'Supaul', 'Uttar Dinajpur'];
  }, [panchayats]);

  const uniqueBlocks = useMemo(() => {
    return Array.from(new Set(panchayats.filter(p => p.district === newDistrict).map(p => p.block))).sort();
  }, [panchayats, newDistrict]);

  const filtered = useMemo(() => {
    return agentsList.filter((a) => {
      if (!showDeactivated && !a.isActive) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.district.toLowerCase().includes(q) ||
        a.block.toLowerCase().includes(q) ||
        a.phone.includes(q)
      );
    });
  }, [search, statusFilter, showDeactivated, agentsList]);

  const stats = useMemo(() => {
    const total = agentsList.length;
    const online = agentsList.filter((a) => a.status === 'online').length;
    const activeShifts = agentsList.filter((a) => a.activeShift).length;
    const totalContacts = agentsList.reduce((sum, a) => sum + a.todayContacts, 0);
    return { total, online, activeShifts, totalContacts };
  }, [agentsList]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewPhotoFile(file);
    setNewPhotoPreview(URL.createObjectURL(file));
  }

  function handleNextStep() {
    if (!newFirstName.trim() || !newLastName.trim()) {
      setStepError('First and last name are required.');
      return;
    }
    if (!/^[0-9]{10}$/.test(newPhone.trim())) {
      setStepError('Mobile number must be exactly 10 digits.');
      return;
    }
    if (newPassword.trim().length < 8) {
      setStepError('Password must be at least 8 characters.');
      return;
    }
    if (!newBlock.trim()) {
      setStepError('Assigned block is required.');
      return;
    }
    setStepError('');
    setStep(2);
  }

  async function handleOnboardSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim() || !newPassword.trim() || !agentId) return;

    setOnboarding(true);
    setOnboardError('');
    try {
      let photoUrl: string | undefined;
      if (newPhotoFile) {
        const uploaded = await uploadPhoto(newPhotoFile);
        photoUrl = uploaded.url;
      }

      const created = await onboardAgent({
        firstName: newFirstName.trim(),
        middleName: newMiddleName.trim() || undefined,
        lastName: newLastName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
        password: newPassword,
        role: newRole,
        district: newDistrict,
        block: newBlock.trim() || newDistrict,
        dateOfBirth: newDob || undefined,
        gender: newGender || undefined,
        address: newAddress.trim() || undefined,
        pincode: newPincode.trim() || undefined,
        education: newEducation.trim() || undefined,
        workExperience: newWorkExperience.trim() || undefined,
        emergencyContactName: newEmergencyName.trim() || undefined,
        emergencyContactPhone: newEmergencyPhone.trim() || undefined,
        photoUrl,
      });

      setGeneratedCreds({
        userId: created.agentId,
        pass: created.password,
        name: created.name,
        role: created.role,
        district: created.district,
        block: created.block,
      });
      void loadAgents();
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : 'Failed to onboard agent.');
    } finally {
      setOnboarding(false);
    }
  }

  async function handleConfirmRemove() {
    if (!removingAgent) return;
    setRemoving(true);
    setRemoveError('');
    try {
      await updateAgentProfile(removingAgent.agentId, { isActive: false });
      setAgentsList((prev) => prev.map((a) => (a.agentId === removingAgent.agentId ? { ...a, isActive: false } : a)));
      setRemovingAgent(null);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove officer.');
    } finally {
      setRemoving(false);
    }
  }

  async function handleReactivate(agent: AdminAgentDto) {
    setReactivatingId(agent.agentId);
    try {
      await updateAgentProfile(agent.agentId, { isActive: true });
      setAgentsList((prev) => prev.map((a) => (a.agentId === agent.agentId ? { ...a, isActive: true } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reactivate officer.');
    } finally {
      setReactivatingId(null);
    }
  }

  async function handleResetPassword() {
    if (!resettingAgent) return;
    setIsResetting(true);
    setResetError('');
    try {
      const newPass = generatePassword();
      await resetAgentPassword(resettingAgent.agentId, newPass);
      setNewGeneratedPassword(newPass);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setIsResetting(false);
    }
  }

  function handleCopyResetCredentials() {
    if (!resettingAgent || !newGeneratedPassword) return;
    const text = `🏢 NexMarket — Field Outreach & Marketing Portal\n\nHello ${resettingAgent.name},\nYour password has been reset by an administrator.\n\nHere are your new login credentials:\nUser ID: ${resettingAgent.agentId}\nPassword: ${newGeneratedPassword}\n\nPlease change this password after you log in.`;
    navigator.clipboard.writeText(text);
    alert('✅ Credentials copied to clipboard!');
  }

  function handleCopyCredentials() {
    if (!generatedCreds) return;
    const text = `🏢 NexMarket — Field Outreach & Marketing Portal\n\nWelcome ${generatedCreds.name} (${generatedCreds.role})!\nYour field territory: ${generatedCreds.district} · ${generatedCreds.block}\n\nHere are your login credentials:\nUser ID: ${generatedCreds.userId}\nPassword: ${generatedCreds.pass}\n\nThis password is shown only once — please save it now.`;
    navigator.clipboard.writeText(text);
    alert('✅ Credentials and welcome message copied to clipboard!');
  }

  function resetModal() {
    setStep(1);
    setStepError('');
    setNewFirstName('');
    setNewMiddleName('');
    setNewLastName('');
    setNewPhone('');
    setNewEmail('');
    setNewPassword('');
    setNewDistrict('Purnia');
    setNewBlock('Kasba');
    setNewRole('Marketing Executive');
    setNewDob('');
    setNewGender('');
    setNewAddress('');
    setNewPincode('');
    setNewEducation('');
    setNewWorkExperience('');
    setNewEmergencyName('');
    setNewEmergencyPhone('');
    setNewPhotoFile(null);
    setNewPhotoPreview(null);
    setGeneratedCreds(null);
    setOnboardError('');
    setShowOnboardModal(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>👥 NexMarket Field Directory</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Manage marketing executives, field officers, regional representatives, and admins across all territories.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: 'var(--color-primary-600)' }}
            onClick={() => setShowOnboardModal(true)}
          >
            ➕ Onboard New Officer
          </button>
          <Link href="/admin/map" className="btn btn-secondary">
            🗺️ Live Map
          </Link>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {/* Summary Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 600, textTransform: 'uppercase' }}>Total Active Officers</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>{stats.total}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, textTransform: 'uppercase' }}>Online Right Now</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#10b981', marginTop: '0.25rem' }}>{stats.online}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase' }}>Active Shifts</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f59e0b', marginTop: '0.25rem' }}>{stats.activeShifts}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: 600, textTransform: 'uppercase' }}>Today&apos;s Contacts Logged</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>{stats.totalContacts}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <input
            type="text"
            className="field-input"
            placeholder="🔍 Search officer by name, district, block, or mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'online', 'low-connectivity', 'offline'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatusFilter(s)}
              style={{ textTransform: 'capitalize' }}
            >
              {s === 'all' ? 'All Status' : s === 'low-connectivity' ? 'Low Signal' : s}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDeactivated} onChange={(e) => setShowDeactivated(e.target.checked)} />
          Show deactivated officers
        </label>
      </div>

      {/* Agents Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--surface-card-hover)', borderBottom: '1px solid var(--surface-border)' }}>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Officer Name & Phone</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Assigned Territory</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Connectivity Status</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Shift Status</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>Visits</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>Contacts</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>Referrals</th>
              <th style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading field officers…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No field officers match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((agent) => (
                <tr key={agent.agentId} style={{ borderBottom: '1px solid var(--surface-border)', opacity: agent.isActive ? 1 : 0.6 }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{agent.name}</div>
                      {!agent.isActive && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', padding: '0.1rem 0.4rem', borderRadius: '8px' }}>
                          DEACTIVATED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>+91 {agent.phone}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{agent.district}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Block: {agent.block}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '12px',
                        background: agent.status === 'online' ? 'rgba(16,185,129,0.2)' : agent.status === 'low-connectivity' ? 'rgba(245,158,11,0.2)' : 'rgba(100,116,139,0.2)',
                        color: agent.status === 'online' ? '#10b981' : agent.status === 'low-connectivity' ? '#f59e0b' : '#94a3b8',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      {agent.status === 'online' ? '🟢 ONLINE' : agent.status === 'low-connectivity' ? '🟡 LOW SIGNAL' : '⚪ OFFLINE'}
                    </span>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {agent.lastSeenAt
                        ? `Last GPS: ${new Date(agent.lastSeenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                        : 'No GPS data yet'}
                    </div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {agent.activeShift ? (
                      <span className="badge badge-online">⏰ Active Shift</span>
                    ) : (
                      <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>💤 Off Duty</span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {agent.todayVisits}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                    <span style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--color-primary-400)', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                      {agent.todayContacts}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontWeight: 600, color: agent.todayReferrals > 0 ? '#10b981' : 'var(--text-muted)' }}>
                    {agent.todayReferrals}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <Link href={`/admin/agents/${encodeURIComponent(agent.agentId)}`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.78rem' }}>
                        👁 View
                      </Link>
                      <Link href={`/admin/agents/${encodeURIComponent(agent.agentId)}?edit=1`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.78rem' }}>
                        ✏️ Edit
                      </Link>
                      <Link href={`/admin/map?agentId=${encodeURIComponent(agent.agentId)}`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.78rem' }}>
                        📍 Trace Route
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.78rem', color: '#8b5cf6' }}
                        onClick={() => { setResettingAgent(agent); setResetError(''); setNewGeneratedPassword(null); }}
                      >
                        🔑 Reset Password
                      </button>
                      {agent.isActive ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.78rem', color: '#ef4444' }}
                          onClick={() => { setRemovingAgent(agent); setRemoveError(''); }}
                        >
                          🚫 Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.78rem', color: '#10b981' }}
                          onClick={() => handleReactivate(agent)}
                          disabled={reactivatingId === agent.agentId}
                        >
                          {reactivatingId === agent.agentId ? '…' : '↩️ Reactivate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Onboard Marketing Officer Drawer */}
      <AnimatePresence>
        {showOnboardModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetModal}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(2px)',
                zIndex: 9998,
              }}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                maxWidth: 520,
                overflowY: 'auto',
                padding: '1.75rem',
                background: 'var(--surface-card)',
                borderLeft: '1px solid var(--surface-border)',
                boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.25)',
                zIndex: 9999,
              }}
            >
            {!generatedCreds ? (
              <form onSubmit={handleOnboardSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '1.35rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      ➕ Onboard Team Member
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {step === 1 ? 'Step 1 of 2 — Account setup' : 'Step 2 of 2 — Additional details'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetModal}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}
                  >
                    ✖
                  </button>
                </div>

                {/* Step indicator */}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-primary-600)' }} />
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: step === 2 ? 'var(--color-primary-600)' : 'var(--surface-border)' }} />
                </div>

                {step === 1 && (
                <>
                {/* Photo */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <label style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{
                      width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
                      background: 'var(--surface-input)', border: '2px dashed var(--surface-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.4rem'
                    }}>
                      {newPhotoPreview ? (
                        <img src={newPhotoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '1.5rem' }}>📷</span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 600 }}>
                      {newPhotoPreview ? 'Change Photo' : 'Add Photo (optional)'}
                    </span>
                    <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
                  </label>
                </div>

                {/* Identity */}
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Identity</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">First Name</label>
                    <input type="text" className="field-input" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} required minLength={2} maxLength={50} />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Middle Name</label>
                    <input type="text" className="field-input" value={newMiddleName} onChange={(e) => setNewMiddleName(e.target.value)} maxLength={50} />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Last Name</label>
                    <input type="text" className="field-input" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} required maxLength={50} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Date of Birth</label>
                    <input type="date" className="field-input" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Sex</label>
                    <select className="field-input" value={newGender} onChange={(e) => setNewGender(e.target.value)} style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                      <option value="">Select…</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Contact & Login */}
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact & Login</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Mobile Number</label>
                    <input
                      type="tel"
                      className="field-input"
                      placeholder="9812345678"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
                      required
                      minLength={10}
                      maxLength={10}
                      pattern="^[0-9]{10}$"
                      title="Mobile number must be exactly 10 digits"
                    />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Email (optional)</label>
                    <input type="email" className="field-input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} maxLength={120} />
                  </div>
                </div>
                <div className="field-group" style={{ margin: 0 }}>
                  <label className="field-label">Password</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="field-input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      maxLength={100}
                      placeholder="Set an initial password"
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewPassword(generatePassword())}>
                      🎲 Generate
                    </button>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    The agent will be required to change this on first login.
                  </p>
                </div>

                {/* Territory & Role */}
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Territory & Role</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Assigned Role</label>
                    <select
                      className="field-input"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}
                    >
                      <option value="Marketing Executive">Marketing Executive</option>
                      <option value="Field Officer">Field Officer</option>
                      <option value="Regional Representative">Regional Representative</option>
                      <option value="Admin">Admin</option>
                    </select>
                    {newRole !== 'Admin' && (
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        This role only has access to the Agent App, not this dashboard.
                      </p>
                    )}
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">District</label>
                    <select
                      className="field-input"
                      value={newDistrict}
                      onChange={(e) => {
                        setNewDistrict(e.target.value);
                        setNewBlock('');
                      }}
                      style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}
                    >
                      {uniqueDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Assigned Block / Council</label>
                    {uniqueBlocks.length > 0 ? (
                      <select
                        className="field-input"
                        value={newBlock}
                        onChange={(e) => setNewBlock(e.target.value)}
                        required
                        style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}
                      >
                        <option value="">Select Block…</option>
                        {uniqueBlocks.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="field-input"
                        placeholder="e.g. Kasba, Forbesganj"
                        value={newBlock}
                        onChange={(e) => setNewBlock(e.target.value)}
                        required
                        maxLength={50}
                      />
                    )}
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Pincode</label>
                    <input type="text" className="field-input" value={newPincode} onChange={(e) => setNewPincode(e.target.value.replace(/\D/g, ''))} maxLength={10} />
                  </div>
                </div>

                {stepError && (
                  <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{stepError}</p>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={resetModal}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" style={{ flex: 1.5, background: 'var(--color-primary-600)' }} onClick={handleNextStep}>
                    Next: Additional Details →
                  </button>
                </div>
                </>
                )}

                {step === 2 && (
                <>
                <div className="field-group" style={{ margin: 0 }}>
                  <label className="field-label">Address</label>
                  <textarea className="field-input" rows={2} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                </div>

                {/* Background */}
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Background</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Education Qualification</label>
                    <input type="text" className="field-input" value={newEducation} onChange={(e) => setNewEducation(e.target.value)} />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Prior Work Experience</label>
                    <input type="text" className="field-input" value={newWorkExperience} onChange={(e) => setNewWorkExperience(e.target.value)} />
                  </div>
                </div>

                {/* Emergency Contact */}
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Emergency Contact</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Contact Person Name</label>
                    <input type="text" className="field-input" value={newEmergencyName} onChange={(e) => setNewEmergencyName(e.target.value)} />
                  </div>
                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Contact Number</label>
                    <input type="tel" className="field-input" value={newEmergencyPhone} onChange={(e) => setNewEmergencyPhone(e.target.value.replace(/\D/g, ''))} maxLength={10} />
                  </div>
                </div>

                {onboardError && (
                  <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{onboardError}</p>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>
                    ← Back
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1.5, background: 'var(--color-primary-600)' }} disabled={onboarding}>
                    {onboarding ? 'Creating…' : '⚡ Generate Credentials'}
                  </button>
                </div>
                </>
                )}
              </form>
            ) : (
              <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🎉</div>
                <h3 style={{ fontSize: '1.4rem', color: '#10b981', marginBottom: '0.25rem' }}>
                  Officer Successfully Onboarded!
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                  {generatedCreds.name} ({generatedCreds.role}) has been added to the field directory.
                </p>

                <div
                  style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid var(--color-primary-500)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '1.25rem',
                    textAlign: 'left',
                    marginBottom: '1.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Generated User ID:</span>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '1.1rem', letterSpacing: '0.05em' }}>
                      {generatedCreds.userId}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Password (shown once):</span>
                    <strong style={{ color: '#10b981', fontSize: '1.1rem', letterSpacing: '0.05em' }}>
                      {generatedCreds.pass}
                    </strong>
                  </div>
                  <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Territory:</span>
                    <span style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>
                      {generatedCreds.district} · {generatedCreds.block}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-full"
                    style={{ background: 'var(--color-primary-600)' }}
                    onClick={handleCopyCredentials}
                  >
                    📋 Copy Welcome SMS / WhatsApp Message
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-full"
                    onClick={resetModal}
                  >
                    Done & Close
                  </button>
                </div>
              </div>
            )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Remove Officer Confirmation */}
      <AnimatePresence>
        {removingAgent && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !removing && setRemovingAgent(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(2px)', zIndex: 9998 }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '100%', maxWidth: 440, background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)',
                padding: '1.75rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)', zIndex: 9999,
              }}
            >
              <h2 style={{ fontSize: '1.15rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>🗑 Remove {removingAgent.name}?</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                This deactivates their account — they&apos;ll no longer be able to log in, and they&apos;ll drop off the active
                directory by default. Their historical contacts, visits and referrals stay intact, and you can reactivate
                them any time from &quot;Show removed officers&quot;.
              </p>

              {removeError && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>{removeError}</p>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setRemovingAgent(null)} disabled={removing}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1, background: '#ef4444' }}
                  onClick={handleConfirmRemove}
                  disabled={removing}
                >
                  {removing ? 'Removing…' : 'Remove Officer'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {resettingAgent && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (!isResetting) { setResettingAgent(null); setNewGeneratedPassword(null); } }}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(2px)', zIndex: 9998
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              style={{
                position: 'fixed', top: '50%', left: '50%', x: '-50%', y: '-50%',
                background: 'white', borderRadius: '12px', padding: '1.5rem',
                width: '90%', maxWidth: '400px', zIndex: 9999,
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
              }}
            >
              <h3 style={{ fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }}>
                Reset Password
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                {!newGeneratedPassword
                  ? `Are you sure you want to generate a new password for ${resettingAgent.name}? They will be forced to change it upon their next login.`
                  : `Password has been reset for ${resettingAgent.name}.`}
              </p>

              {resetError && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{resetError}</p>}

              {newGeneratedPassword ? (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>New Password</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981', marginTop: '0.25rem', letterSpacing: '0.05em' }}>{newGeneratedPassword}</div>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                {!newGeneratedPassword ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setResettingAgent(null)}
                      disabled={isResetting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ background: '#8b5cf6' }}
                      onClick={handleResetPassword}
                      disabled={isResetting}
                    >
                      {isResetting ? 'Resetting...' : 'Yes, Reset Password'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => { setResettingAgent(null); setNewGeneratedPassword(null); }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleCopyResetCredentials}
                    >
                      📋 Copy
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
