'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword, syncPull } from '@/lib/sync/api-client';
import { setSyncStateValue, isLocalDatabaseEmpty, getOrCreateDeviceId, db } from '@/lib/db';
import { refreshReferenceData } from '@/lib/sync/seeder';
import { useAgentStore } from '@/store/agent-store';
import type { LocalContact, LocalVisit, LocalShift, LocalReferral, LocalPanchayat } from '@/lib/db/schema';
import { motion } from 'framer-motion';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import NexMarketLogo from '@/components/NexMarketLogo';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAgentStore((s) => s.setAuth);

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  async function performLogin(targetId: string, targetPass: string) {
    setError('');
    setIsLoading(true);
    setIsInitializing(true);

    try {
      const deviceId = await getOrCreateDeviceId();
      const auth = await loginWithPassword(targetId, targetPass, deviceId);

      // Persist to Dexie syncState for sync engine — no token here, the JWT
      // and refresh token are httpOnly cookies now, invisible to this code.
      await setSyncStateValue('agentId', auth.agentId);
      await setSyncStateValue('deviceId', auth.deviceId);

      // Persist to Zustand
      setAuth({
        agentId: auth.agentId,
        deviceId: auth.deviceId,
        name: auth.name,
        role: auth.role,
        profileCompleted: auth.profileCompleted,
      });

      // Refresh panchayats + questionnaire unconditionally (not just when
      // empty) — every login is a chance to pick up admin-side changes that
      // a previously-onboarded device would otherwise never see again.
      await refreshReferenceData();

      // Reinstall recovery: if local DB is empty, pull down all agent data
      const isEmpty = await isLocalDatabaseEmpty();
      if (isEmpty) {
        try {
          let hasMore = true;
          let page = 1;
          const pageSize = 500;
          
          while (hasMore) {
            const pulled = await syncPull({
              agentId: auth.agentId,
              deviceId: auth.deviceId,
              since: '1970-01-01T00:00:00Z',
              page,
              pageSize
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
            if (pulled.surveys?.length) {
              await db.surveyResponses.bulkPut(
                (pulled.surveys as import('@/lib/db/schema').LocalSurveyResponse[]).map((s) => ({ ...s, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.surveyQuestions?.length) {
              await db.surveyQuestions.bulkPut(pulled.surveyQuestions);
            }

            hasMore = pulled.hasMore;
            page++;
          }
        } catch (pullErr) {
          console.warn('Reinstall recovery pull failed — continuing with an empty local DB:', pullErr);
        }
      }

      if (auth.mustChangePassword) {
        router.push('/change-password');
      } else if (auth.role?.toLowerCase() === 'admin') {
        router.push('/admin/agents');
      } else {
        router.push('/home');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid User ID or Password. Please try again.');
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

  return (
    <div className="login-split-container">
      {/* Background glow accents for premium feel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
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
      <motion.div 
        className="login-showcase-panel"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
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
            Empowering field officers, regional representatives, and executives with instant territory intelligence, offline synchronization, and standardized RBAC access.
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
            <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Regional Partners</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Active merchants, distributors, and local influencers</div>
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
              NexMarket Outreach Network · Live Outbox Engine Active
            </span>
          </div>
          <span style={{ color: 'var(--color-primary-600)', fontSize: '0.8rem', fontWeight: 700 }}>
            v2.4 LTS
          </span>
        </div>
      </motion.div>

      {/* RIGHT 1/3rd PANEL / NATIVE MOBILE LAYOUT */}
      <motion.div 
        className="login-form-panel"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
      >
        {/* Native App Top/Hero Section (Mobile Only) */}
        <div className="login-mobile-hero">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              width: 56,
              height: 56,
              background: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%)',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
              marginBottom: '1rem'
            }}
          >
            <NexMarketLogo size={32} />
          </motion.div>
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.04em', marginBottom: '0.25rem' }}
          >
            NexMarket
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
            style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.85)', fontWeight: 500, letterSpacing: '0.01em' }}
          >
            Field Operations Platform
          </motion.p>
        </div>

        {/* Desktop Title (Desktop Only) */}
        <div className="login-desktop-title">
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
        </div>

        {/* Bottom Sheet Style Card (Mobile) / Form Card (Desktop) */}
        <div className="login-card-container">
          <PwaInstallPrompt />
          
          {isInitializing ? (
            <div style={{ textAlign: 'center', padding: '1rem 0', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: '3px solid #f1f5f9',
                  borderTopColor: 'var(--color-primary-600)',
                  borderRadius: '50%',
                  margin: '0 auto 1.5rem',
                }}
                className="spin"
              />
              <h3 style={{ color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.15rem', fontWeight: 800 }}>
                Authenticating…
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Syncing territory data...
              </p>
            </div>
          ) : (
            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
              <div style={{ marginBottom: '0.25rem' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Welcome Back
                </h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Please sign in to continue
                </p>
              </div>

              {/* Minimal Native Inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </div>
                  <input
                    id="userid-input"
                    type="text"
                    placeholder="Contact No. or Email"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    autoComplete="username"
                    required
                    minLength={3}
                    style={{
                      width: '100%',
                      padding: '1.1rem 1rem 1.1rem 3rem',
                      background: '#f8fafc',
                      border: 'none',
                      borderRadius: '16px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      outline: 'none',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => { e.target.style.background = '#eef2ff'; e.target.style.boxShadow = 'inset 0 0 0 1px #818cf8'; }}
                    onBlur={(e) => { e.target.style.background = '#f8fafc'; e.target.style.boxShadow = 'none'; }}
                  />
                </div>

                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  </div>
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    minLength={6}
                    style={{
                      width: '100%',
                      padding: '1.1rem 3rem 1.1rem 3rem',
                      background: '#f8fafc',
                      border: 'none',
                      borderRadius: '16px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      outline: 'none',
                      transition: 'all 0.2s',
                    }}
                    onFocus={(e) => { e.target.style.background = '#eef2ff'; e.target.style.boxShadow = 'inset 0 0 0 1px #818cf8'; }}
                    onBlur={(e) => { e.target.style.background = '#f8fafc'; e.target.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: '0.75rem',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '0.5rem',
                      display: 'flex'
                    }}
                  >
                    {showPassword ? (
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  style={{
                    padding: '0.85rem',
                    borderRadius: '12px',
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    fontWeight: 600,
                  }}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>{error}</span>
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
                <button
                  type="submit"
                  disabled={isLoading || !userId.trim() || !password.trim()}
                  style={{
                    width: '100%',
                    height: '56px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    color: 'white',
                    border: 'none',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    letterSpacing: '0.02em',
                    boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)',
                    cursor: (isLoading || !userId.trim() || !password.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (isLoading || !userId.trim() || !password.trim()) ? 0.7 : 1,
                    transition: 'transform 0.15s, box-shadow 0.15s'
                  }}
                  onMouseOver={(e) => !isLoading && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 12px 28px rgba(79, 70, 229, 0.45)')}
                  onMouseOut={(e) => !isLoading && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 8px 20px rgba(79, 70, 229, 0.3)')}
                  onMouseDown={(e) => !isLoading && (e.currentTarget.style.transform = 'translateY(1px)', e.currentTarget.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.2)')}
                  onMouseUp={(e) => !isLoading && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 12px 28px rgba(79, 70, 229, 0.45)')}
                >
                  {isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <svg className="spin" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Signing in…
                    </div>
                  ) : 'Sign In'}
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: '1rem', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 500 }}>
                Protected by NexMarket Security
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
