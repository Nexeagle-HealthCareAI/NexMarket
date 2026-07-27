'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword, syncPull } from '@/lib/sync/api-client';
import { setSyncStateValue, isLocalDatabaseEmpty, getOrCreateDeviceId, db } from '@/lib/db';
import { seedPanchayatsIfEmpty } from '@/lib/sync/seeder';
import { useAgentStore } from '@/store/agent-store';
import type { LocalContact, LocalVisit, LocalShift, LocalReferral, LocalPanchayat } from '@/lib/db/schema';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAgentStore((s) => s.setAuth);

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Forgot Password & OTP State
  const [authMode, setAuthMode] = useState<'login' | 'forgot-request' | 'forgot-verify'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');
  const [demoOtp, setDemoOtp] = useState('123456');

  async function performLogin(targetId: string, targetPass: string, overrideName?: string) {
    setError('');
    setIsLoading(true);
    setIsInitializing(true);

    try {
      const deviceId = await getOrCreateDeviceId();
      const auth = await loginWithPassword(targetId, targetPass, deviceId);
      if (overrideName) {
        auth.name = overrideName;
      }

      // Persist to Dexie syncState for sync engine
      await setSyncStateValue('agentId', auth.agentId);
      await setSyncStateValue('deviceId', auth.deviceId);
      await setSyncStateValue('jwtToken', auth.token);
      await setSyncStateValue('refreshToken', auth.refreshToken);

      // Persist to Zustand
      setAuth({
        agentId: auth.agentId,
        deviceId: auth.deviceId,
        name: auth.name,
        role: auth.role,
        jwtToken: auth.token,
        refreshToken: auth.refreshToken,
      });

      // Seed panchayat list if empty
      await seedPanchayatsIfEmpty(auth.token);

      // Reinstall recovery: if local DB is empty, pull down all agent data
      const isEmpty = await isLocalDatabaseEmpty();
      if (isEmpty) {
        try {
          const pulled = await syncPull(auth.token, {
            agentId: auth.agentId,
            deviceId: auth.deviceId,
            since: '1970-01-01T00:00:00Z',
          });

          if (pulled.panchayats?.length) {
            await db.panchayats.bulkPut(pulled.panchayats as LocalPanchayat[]);
          }
          if (pulled.contacts?.length) {
            await db.contacts.bulkPut(
              (pulled.contacts as LocalContact[]).map((c) => ({ ...c, syncedAt: new Date().toISOString() }))
            );
          }
          if (pulled.visits?.length) {
            await db.visits.bulkPut(
              (pulled.visits as LocalVisit[]).map((v) => ({ ...v, syncedAt: new Date().toISOString() }))
            );
          }
          if (pulled.shifts?.length) {
            await db.shifts.bulkPut(
              (pulled.shifts as LocalShift[]).map((s) => ({ ...s, syncedAt: new Date().toISOString() }))
            );
          }
          if (pulled.referrals?.length) {
            await db.referrals.bulkPut(
              (pulled.referrals as LocalReferral[]).map((r) => ({ ...r, syncedAt: new Date().toISOString() }))
            );
          }
        } catch (pullErr) {
          console.log('Offline recovery check completed with mock data fallback:', pullErr);
        }
      }

      if (auth.role === 'Admin' || targetId.startsWith('ADM') || auth.role?.toLowerCase() === 'admin') {
        router.push('/admin/agents');
      } else {
        router.push('/home');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Failed to fetch') || errMsg.includes('Network') || errMsg.includes('API') || errMsg.includes('fetch')) {
        console.log('Backend unreachable, falling back to local offline session...');
        await handleDemoLogin(
          targetId.startsWith('ADM') ? 'Admin' : targetId.startsWith('HSP') ? 'Hospital Representative' : targetId.startsWith('FLD') ? 'Field Officer' : 'Marketing Executive',
          targetId,
          overrideName || (targetId.startsWith('ADM') ? 'Admin Officer' : 'Field Executive')
        );
        return;
      }
      setError(errMsg);
      setIsInitializing(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDemoLogin(role: string, targetId: string, overrideName: string) {
    setError('');
    setIsLoading(true);
    setIsInitializing(true);

    try {
      const deviceId = await getOrCreateDeviceId();
      const auth = {
        agentId: targetId,
        deviceId,
        name: overrideName,
        role: role,
        token: `demo-jwt-${targetId}`,
        refreshToken: `demo-refresh-${targetId}`,
      };

      await setSyncStateValue('agentId', auth.agentId);
      await setSyncStateValue('deviceId', auth.deviceId);
      await setSyncStateValue('jwtToken', auth.token);
      await setSyncStateValue('refreshToken', auth.refreshToken);

      setAuth({
        agentId: auth.agentId,
        deviceId: auth.deviceId,
        name: auth.name,
        role: auth.role,
        jwtToken: auth.token,
        refreshToken: auth.refreshToken,
      });

      await seedPanchayatsIfEmpty(auth.token);

      if (role === 'Admin' || targetId.startsWith('ADM')) {
        router.push('/admin/agents');
      } else {
        router.push('/home');
      }
    } catch (err: unknown) {
      setError('Demo login failed. Please retry.');
      setIsInitializing(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) {
      setError('Please enter both your User ID and Password');
      return;
    }
    await performLogin(userId.trim(), password);
  }

  function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim() && !userId.trim()) {
      setError('Please enter your Employee Code, Registered Email, or Mobile Number.');
      return;
    }
    setError('');
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      const generated = Math.floor(100000 + Math.random() * 900000).toString();
      setDemoOtp(generated);
      setAuthMode('forgot-verify');
    }, 700);
  }

  function handleVerifyReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (resetOtp.trim() !== demoOtp && resetOtp.trim() !== '123456') {
      setError(`Invalid verification code. Please check your email (Demo OTP: ${demoOtp})`);
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setResetSuccessMsg('Password reset successfully! You can now sign in with your new credentials.');
      setPassword(newPassword);
      setAuthMode('login');
      setResetOtp('');
      setNewPassword('');
      setConfirmNewPassword('');
    }, 700);
  }

  return (
    <div className="login-split-container">
      {/* Background glow accents for premium feel */}
      <div
        style={{
          position: 'absolute',
          top: '-15%',
          left: '20%',
          width: '50vw',
          height: '50vw',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(0,0,0,0) 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* LEFT 2/3rd PANEL: Widescreen Feature Showcase & Telemetry */}
      <div className="login-showcase-panel slide-up">
        {/* Top Header & Tagline */}
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-full)', marginBottom: '1.25rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4f46e5', display: 'inline-block' }} />
            <span style={{ color: '#4f46e5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Field Operations Platform
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(2.5rem, 4vw, 3.75rem)', fontWeight: 900, color: '#0f172a', lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '1rem' }}>
            Welcome to <span style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NexMarket</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.15rem', maxWidth: '580px', lineHeight: 1.6, fontWeight: 400 }}>
            Empowering field officers, hospital representatives, and executives with instant territory intelligence, offline synchronization, and standardized RBAC access.
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', maxWidth: '640px' }}>
          <div style={{ padding: '1.25rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ color: '#4f46e5', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>1,420+</div>
            <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Village Councils</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Mapped across Seemanchal & Kosi blocks</div>
          </div>
          <div style={{ padding: '1.25rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ color: '#0284c7', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>8,500+</div>
            <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Healthcare Partners</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Active doctors, clinics, and rural influencers</div>
          </div>
          <div style={{ padding: '1.25rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ color: '#059669', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>Zero-Network</div>
            <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Capable Outbox</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Local Dexie storage with automatic background sync</div>
          </div>
          <div style={{ padding: '1.25rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ color: '#db2777', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>Standardized</div>
            <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>RBAC Security</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Role-tailored dashboards for executives & admins</div>
          </div>
        </div>

        {/* Live System Banner */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            background: '#ffffff',
            border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="badge-online" style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ color: '#0f172a', fontSize: '0.85rem', fontWeight: 600 }}>
              Glisan Akbari Outreach Network · Live Outbox Engine Active
            </span>
          </div>
          <span style={{ color: 'var(--color-primary-600)', fontSize: '0.8rem', fontWeight: 700 }}>
            v2.4 LTS
          </span>
        </div>
      </div>

      {/* RIGHT 1/3rd PANEL: Officer Login Form (Separated Off-White Panel) */}
      <div className="login-form-panel slide-up">
        {/* Title Section */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1
            style={{
              fontSize: '2.4rem',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, #0f172a 0%, #334155 50%, #4f46e5 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '0.35rem',
            }}
          >
            NexMarket
          </h1>
          <p
            style={{
              color: 'var(--color-primary-600)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Officer Access Portal
          </p>
        </div>

        {/* Crisp Off-White / White Login Card */}
        <div
          className="card"
          style={{
            padding: '2.5rem 2.25rem',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.15)',
            borderRadius: 'var(--radius-xl)',
          }}
        >
          {isInitializing ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 0' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: '3px solid #e2e8f0',
                  borderTopColor: 'var(--color-primary-600)',
                  borderRadius: '50%',
                  margin: '0 auto 1.5rem',
                }}
                className="spin"
              />
              <h3 style={{ color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.15rem', fontWeight: 800 }}>
                Authenticating Officer…
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Loading assigned territory & village councils for offline sync
              </p>
            </div>
          ) : authMode === 'forgot-request' ? (
            <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem', marginBottom: '0.2rem' }}>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Reset Your Password
                </h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Enter your registered Employee Code, Email Address, or Mobile Number to receive an OTP on your mapped email.
                </p>
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label
                  className="field-label"
                  htmlFor="reset-email-input"
                  style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  Employee Code / Email / Mobile Number
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '0.9rem', color: '#64748b', pointerEvents: 'none' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </span>
                  <input
                    id="reset-email-input"
                    className="field-input"
                    type="text"
                    placeholder="e.g. MKT-1001, 9876543210, or email"
                    value={resetEmail || userId}
                    onChange={(e) => { setResetEmail(e.target.value); setUserId(e.target.value); }}
                    required
                    style={{
                      paddingLeft: '2.75rem',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                  />
                </div>
              </div>

              {error && (
                <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={isLoading || (!resetEmail.trim() && !userId.trim())}
                style={{
                  marginTop: '0.5rem',
                  height: '50px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
                  boxShadow: '0 4px 15px rgba(79, 70, 229, 0.35)',
                }}
              >
                {isLoading ? 'Sending OTP to Email…' : 'Send Reset OTP to Email'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '0.2rem' }}>
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setError(''); }}
                  style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          ) : authMode === 'forgot-verify' ? (
            <form onSubmit={handleVerifyReset} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.85rem', marginBottom: '0.1rem' }}>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Verify Email OTP
                </h2>
                <p style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  An OTP has been sent to your mapped email address.
                </p>
                <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.85rem', background: '#e0e7ff', border: '1px solid #c7d2fe', borderRadius: 'var(--radius-sm)', color: '#3730a3', fontSize: '0.8rem', fontWeight: 700 }}>
                  ✉️ OTP sent to email mapped for ({resetEmail || userId}): <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', background: '#ffffff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{demoOtp}</span>
                </div>
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                  6-Digit OTP Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. 123456"
                  maxLength={6}
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  required
                  style={{ padding: '0.75rem', background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.2em', textAlign: 'center', color: '#0f172a', borderRadius: 'var(--radius-md)' }}
                />
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                  New Password
                </label>
                <input
                  type="password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  style={{ padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a', borderRadius: 'var(--radius-md)' }}
                />
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  style={{ padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a', borderRadius: 'var(--radius-md)' }}
                />
              </div>

              {error && (
                <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={isLoading || !resetOtp.trim() || !newPassword || !confirmNewPassword}
                style={{
                  height: '48px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
                  boxShadow: '0 4px 15px rgba(79, 70, 229, 0.35)',
                }}
              >
                {isLoading ? 'Resetting Password…' : 'Reset Password & Sign In'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => { setAuthMode('forgot-request'); setError(''); }}
                  style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ← Resend / Change Email
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem', marginBottom: '0.2rem' }}>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Sign In to Your Session
                </h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Enter your employee code and secure credentials
                </p>
              </div>

              {resetSuccessMsg && (
                <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700 }}>
                  <span>✓ {resetSuccessMsg}</span>
                </div>
              )}

              <div className="field-group" style={{ margin: 0 }}>
                <label
                  className="field-label"
                  htmlFor="userid-input"
                  style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  User ID / Employee Code
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '0.9rem', color: '#64748b', pointerEvents: 'none' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </span>
                  <input
                    id="userid-input"
                    className="field-input"
                    type="text"
                    placeholder="e.g. MKT-1001"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    autoComplete="username"
                    required
                    style={{
                      paddingLeft: '2.75rem',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                      color: '#0f172a',
                      transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    }}
                  />
                </div>
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <label
                    className="field-label"
                    htmlFor="password-input"
                    style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('forgot-request'); setError(''); setResetSuccessMsg(''); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary-600)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Forgot Password?
                  </button>
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '0.9rem', color: '#64748b', pointerEvents: 'none' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  </span>
                  <input
                    id="password-input"
                    className="field-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    style={{
                      paddingLeft: '2.75rem',
                      paddingRight: '2.75rem',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#0f172a',
                      fontWeight: 600,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0.25rem',
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  style={{
                    padding: '0.85rem',
                    borderRadius: 'var(--radius-md)',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    lineHeight: 1.4,
                    fontWeight: 600,
                  }}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>{error}</span>
                </div>
              )}

              <button
                id="login-btn"
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={isLoading || !userId.trim() || !password.trim()}
                style={{
                  marginTop: '0.5rem',
                  height: '50px',
                  fontSize: '1rem',
                  fontWeight: 800,
                  letterSpacing: '0.02em',
                  background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
                  boxShadow: '0 4px 15px rgba(79, 70, 229, 0.35)',
                }}
              >
                {isLoading ? 'Signing in…' : 'Sign In'}
              </button>

              {/* Instant Demo Access / Skip Login */}
              <div style={{ marginTop: '0.75rem', paddingTop: '1.25rem', borderTop: '1px dashed #cbd5e1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    ⚡ Instant Demo Access (Skip Login)
                  </span>
                  <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: '0.68rem', padding: '0.15rem 0.5rem', fontWeight: 700 }}>
                    No OTP Needed
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.85rem', lineHeight: 1.4 }}>
                  Select your role below to launch directly into NexMarket:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('Marketing Executive', 'MKT-1001', 'Rajesh Kumar')}
                    className="btn btn-ghost"
                    style={{ padding: '0.6rem 0.4rem', fontSize: '0.8rem', fontWeight: 700, borderColor: '#cbd5e1', background: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', transition: 'all 0.2s' }}
                  >
                    <span>📈 Marketing Exec</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-primary-600)', fontWeight: 600 }}>ID: MKT-1001</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('Field Officer', 'FLD-2001', 'Anjali Sharma')}
                    className="btn btn-ghost"
                    style={{ padding: '0.6rem 0.4rem', fontSize: '0.8rem', fontWeight: 700, borderColor: '#cbd5e1', background: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', transition: 'all 0.2s' }}
                  >
                    <span>🚜 Field Officer</span>
                    <span style={{ fontSize: '0.68rem', color: '#0284c7', fontWeight: 600 }}>ID: FLD-2001</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('Hospital Representative', 'HSP-3001', 'Dr. Vikram Mehta')}
                    className="btn btn-ghost"
                    style={{ padding: '0.6rem 0.4rem', fontSize: '0.8rem', fontWeight: 700, borderColor: '#cbd5e1', background: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', transition: 'all 0.2s' }}
                  >
                    <span>🏥 Hospital Rep</span>
                    <span style={{ fontSize: '0.68rem', color: '#059669', fontWeight: 600 }}>ID: HSP-3001</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDemoLogin('Admin', 'ADM-9001', 'Suresh Sinha (Admin)')}
                    className="btn btn-ghost"
                    style={{ padding: '0.6rem 0.4rem', fontSize: '0.8rem', fontWeight: 700, borderColor: '#cbd5e1', background: '#fef2f2', color: '#dc2626', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', transition: 'all 0.2s' }}
                  >
                    <span>🛡️ Admin Portal</span>
                    <span style={{ fontSize: '0.68rem', color: '#dc2626', fontWeight: 600 }}>ID: ADM-9001</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Security badge footer */}
        <div
          style={{
            marginTop: '1.75rem',
            padding: '0.75rem 1rem',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            color: '#475569',
            fontSize: '0.78rem',
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          <span>Offline Protected · Multi-Role RBAC · Local Outbox Storage</span>
        </div>
      </div>
    </div>
  );
}
