'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword } from '@/lib/sync/api-client';
import { useAgentStore } from '@/store/agent-store';

export default function ChangePasswordPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const role = useAgentStore((s) => s.role);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (!agentId) {
      setError('Your session has expired — please sign in again.');
      return;
    }

    setIsLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      router.push(role?.toLowerCase() === 'admin' ? '/admin/agents' : '/home');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="login-split-container">
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

      <div className="login-showcase-panel slide-up">
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-full)', marginBottom: '1.25rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            <span style={{ color: '#b45309', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Security Step Required
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(2.5rem, 4vw, 3.75rem)', fontWeight: 900, color: '#0f172a', lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '1rem' }}>
            Set Your <span style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Own Password</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.15rem', maxWidth: '580px', lineHeight: 1.6, fontWeight: 400 }}>
            You&apos;re signed in with a system-issued password. Choose a new one before continuing — this only takes a moment.
          </p>
        </div>
      </div>

      <div className="login-form-panel slide-up">
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
            Change Password
          </p>
        </div>

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
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem', marginBottom: '0.2rem' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                Update Your Password
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Enter your current password and choose a new one.
              </p>
            </div>

            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label" htmlFor="current-password" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Current Password
              </label>
              <input
                id="current-password"
                className="field-input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{ background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a' }}
              />
            </div>

            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label" htmlFor="new-password" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                New Password
              </label>
              <input
                id="new-password"
                className="field-input"
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                style={{ background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a' }}
              />
            </div>

            <div className="field-group" style={{ margin: 0 }}>
              <label className="field-label" htmlFor="confirm-password" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                className="field-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                style={{ background: '#f8fafc', border: '1px solid #cbd5e1', fontWeight: 600, color: '#0f172a' }}
              />
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
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-full btn-lg"
              disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
              style={{
                marginTop: '0.5rem',
                height: '50px',
                fontSize: '1rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
                boxShadow: '0 4px 15px rgba(79, 70, 229, 0.35)',
              }}
            >
              {isLoading ? 'Updating…' : 'Update Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
