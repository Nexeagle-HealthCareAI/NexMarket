'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MOCK_AGENTS, addMockAgent, type AdminAgent } from '@/lib/admin/mock-data';

export default function AgentsClient() {
  const [agentsList, setAgentsList] = useState<AdminAgent[]>(MOCK_AGENTS);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'low-connectivity' | 'offline'>('all');

  // Onboarding Modal State
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newDistrict, setNewDistrict] = useState('Purnia');
  const [newBlock, setNewBlock] = useState('Kasba');
  const [newRole, setNewRole] = useState('Marketing Executive');
  const [generatedCreds, setGeneratedCreds] = useState<{
    userId: string;
    pass: string;
    name: string;
    role: string;
    district: string;
    block: string;
  } | null>(null);

  const filtered = useMemo(() => {
    return agentsList.filter((a) => {
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
  }, [search, statusFilter, agentsList]);

  const stats = useMemo(() => {
    const total = agentsList.length;
    const online = agentsList.filter((a) => a.status === 'online').length;
    const activeShifts = agentsList.filter((a) => a.activeShift).length;
    const totalContacts = agentsList.reduce((sum, a) => sum + a.todayContacts, 0);
    return { total, online, activeShifts, totalContacts };
  }, [agentsList]);

  function handleOnboardSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;

    // Generate credentials
    const nextNum = 1000 + agentsList.length + 1;
    const genUserId = `MKT-${nextNum}`;
    const genPass = `Glisan#2026`;

    const newAgent: AdminAgent = {
      agentId: `agent-${nextNum}`,
      name: newName.trim(),
      role: newRole,
      phone: newPhone.trim(),
      district: newDistrict,
      block: newBlock.trim() || newDistrict,
      status: 'offline',
      lastSeenLat: 25.7771,
      lastSeenLng: 87.4753,
      lastSeenAt: new Date().toISOString(),
      batteryPct: 100,
      activeShift: false,
      todayContacts: 0,
      todayVisits: 0,
      todayReferrals: 0,
    };

    addMockAgent(newAgent);
    setAgentsList([...MOCK_AGENTS]);

    setGeneratedCreds({
      userId: genUserId,
      pass: genPass,
      name: newAgent.name,
      role: newRole,
      district: newAgent.district,
      block: newAgent.block,
    });
  }

  function handleCopyCredentials() {
    if (!generatedCreds) return;
    const text = `🏥 NexMarket — Healthcare Outreach Portal\n\nWelcome ${generatedCreds.name} (${generatedCreds.role})!\nYour field territory: ${generatedCreds.district} · ${generatedCreds.block}\n\nHere are your login credentials:\nUser ID: ${generatedCreds.userId}\nPassword: ${generatedCreds.pass}\n\nLogin URL: http://localhost:3001/login`;
    navigator.clipboard.writeText(text);
    alert('✅ Credentials and welcome message copied to clipboard!');
  }

  function resetModal() {
    setNewName('');
    setNewPhone('');
    setNewDistrict('Purnia');
    setNewBlock('Kasba');
    setNewRole('Marketing Executive');
    setGeneratedCreds(null);
    setShowOnboardModal(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: '#f8fafc', marginBottom: '0.2rem' }}>👥 NexMarket Field Directory</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Manage marketing executives, field officers, hospital representatives, and admins across all territories.
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No field officers match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((agent) => (
                <tr key={agent.agentId} style={{ borderBottom: '1px solid var(--surface-border)', transition: 'background 0.2s' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{agent.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>+91 {agent.phone}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{agent.district}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Block: {agent.block}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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
                      <span style={{ fontSize: '0.78rem', color: agent.batteryPct < 20 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                        🔋 {agent.batteryPct}%
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      Last GPS: {new Date(agent.lastSeenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
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
                    <Link href="/admin/map" className="btn btn-ghost btn-sm" style={{ fontSize: '0.78rem' }}>
                      📍 Trace Route
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Onboard Marketing Officer Modal */}
      {showOnboardModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
            <div
              className="card slide-up"
              style={{
                width: '100%',
                maxWidth: 480,
                padding: '1.75rem',
                background: 'var(--surface-card)',
                border: '1px solid var(--color-primary-500)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.2)',
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
                        Assign territory & generate instant login credentials
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

                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Full Name</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. Anjali Sharma"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                    />
                  </div>

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
                        maxLength={10}
                      />
                    </div>

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
                        <option value="Hospital Representative">Hospital Representative</option>
                        <option value="Admin">Admin</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="field-group" style={{ margin: 0 }}>
                      <label className="field-label">District</label>
                      <select
                        className="field-input"
                        value={newDistrict}
                        onChange={(e) => setNewDistrict(e.target.value)}
                        style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}
                      >
                      <option value="Katihar">Katihar</option>
                      <option value="Purnia">Purnia</option>
                      <option value="Araria">Araria</option>
                      <option value="Supaul">Supaul</option>
                    </select>
                  </div>

                  <div className="field-group" style={{ margin: 0 }}>
                    <label className="field-label">Assigned Block / Council</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. Kasba, Forbesganj"
                      value={newBlock}
                      onChange={(e) => setNewBlock(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={resetModal}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1.5, background: 'var(--color-primary-600)' }}>
                    ⚡ Generate Credentials
                  </button>
                </div>
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
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Initial Password:</span>
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
          </div>
        </div>
      )}
    </div>
  );
}
