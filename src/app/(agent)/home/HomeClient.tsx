'use client';

import { useState } from 'react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { useActiveShift, useActiveVisit, useContacts, useVisits, useOutboxCount, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { triggerManualSync } from '@/lib/sync/engine';
import { useGeolocation } from '@/lib/geo/useGeolocation';
import { CurrentLocationBanner } from '@/components/CurrentLocationBanner';
import type { LocalShift } from '@/lib/db/schema';

import { motion, type Variants } from 'framer-motion';
import { useTranslations } from '@/i18n/I18nProvider';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.4, ease: "easeOut" } }
};

export default function HomeClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const name = useAgentStore((s) => s.name);
  const setActiveShift = useAgentStore((s) => s.setActiveShift);
  const t = useTranslations();

  const activeShift = useActiveShift(agentId ?? undefined);
  const activeVisit = useActiveVisit(agentId ?? undefined);
  const contacts = useContacts(agentId ?? undefined);
  const visits = useVisits(agentId ?? undefined);
  const outboxCount = useOutboxCount();

  const { position, permission } = useGeolocation({
    shiftId: activeShift?.clientId,
    record: !!activeShift,
  });

  const [syncing, setSyncing] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);

  const isOnShift = !!activeShift && !activeShift.endAt;

  async function handleStartShift() {
    if (!agentId || !deviceId) return;
    setShiftLoading(true);
    const clientId = uuidv4();
    const shift: LocalShift = { clientId, deviceId, agentId, startAt: new Date().toISOString() };
    await db.shifts.add(shift);
    await addToOutbox(clientId, deviceId, 'shift', shift);
    setActiveShift(clientId);
    setShiftLoading(false);
  }

  async function handleEndShift() {
    if (!activeShift?.localId || !agentId || !deviceId) return;
    setShiftLoading(true);
    const endAt = new Date().toISOString();
    await db.shifts.update(activeShift.localId, { endAt });
    await addToOutbox(activeShift.clientId, deviceId, 'shift', { ...activeShift, endAt });
    setActiveShift(null);
    setShiftLoading(false);
  }

  async function handleManualSync() {
    setSyncing(true);
    await triggerManualSync();
    setSyncing(false);
  }

  const todayContacts = contacts?.filter(
    (c) => new Date(c.createdAt).toDateString() === new Date().toDateString()
  ).length ?? 0;

  const todayVisits = visits?.filter(
    (v) => new Date(v.checkInAt).toDateString() === new Date().toDateString()
  ).length ?? 0;

  const dailyTarget = 20;
  const progressPercent = Math.min((todayVisits / dailyTarget) * 100, 100);

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ padding: '0.5rem 0 2rem' }}
    >
      {/* ─── Hero Welcome Section ────────────────────────────────────────── */}
      <motion.div variants={itemVariants} style={{
        background: 'linear-gradient(135deg, var(--color-primary-600) 0%, var(--color-primary-800) 100%)',
        borderRadius: '1.5rem',
        padding: '2rem 1.5rem',
        color: 'white',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.4)',
        marginBottom: '1.5rem'
      }}>
        {/* Decorative background circles */}
        <div style={{ position: 'absolute', top: -50, right: -50, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: 100, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
              {t.greeting}, <br/>{name?.split(' ')[0] ?? t.defaultAgentName}! 👋
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)' }}>
              {isOnShift ? t.homeGreetingActive : t.homeGreetingInactive}
            </p>
          </div>
          
          {/* Sync Button floating on top right of hero */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
            {syncing ? (
              <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.4rem 0.75rem', borderRadius: '2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 600 }}>
                <svg className="spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 11-4.219-7.64" /></svg>
                {t.syncing}
              </div>
            ) : outboxCount && outboxCount > 0 ? (
              <button onClick={handleManualSync} style={{ background: '#f59e0b', color: 'white', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 12a9 9 0 11-4.219-7.64" /></svg>
                {outboxCount} {t.pending}
              </button>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.4rem 0.75rem', borderRadius: '2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%' }} /> {t.synced}
              </div>
            )}
          </div>
        </div>

        {/* Shift Control inside Hero */}
        <div style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.1)', padding: '1rem', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backdropFilter: 'blur(10px)' }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', fontWeight: 600, textTransform: 'uppercase' }}>{t.shiftStatus}</p>
            {isOnShift ? (
              <p style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: 8, height: 8, background: '#4ade80', borderRadius: '50%', boxShadow: '0 0 8px #4ade80' }} />
                {t.activeSince} {new Date(activeShift!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            ) : (
              <p style={{ color: 'white', fontWeight: 600, fontSize: '0.95rem' }}>{t.notStarted}</p>
            )}
          </div>
          <button 
            onClick={isOnShift ? handleEndShift : handleStartShift} 
            disabled={shiftLoading || permission === 'denied'}
            style={{ 
              background: isOnShift ? 'rgba(239,68,68,0.9)' : 'white', 
              color: isOnShift ? 'white' : 'var(--color-primary-700)', 
              border: 'none', padding: '0.6rem 1.25rem', borderRadius: '2rem', 
              fontWeight: 800, cursor: 'pointer', transition: 'transform 0.2s',
              boxShadow: isOnShift ? '0 4px 12px rgba(239,68,68,0.3)' : '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            {shiftLoading ? '…' : isOnShift ? t.endShift : t.startShift}
          </button>
        </div>

        {/* Current Location Banner embedded in Hero */}
        <CurrentLocationBanner position={position} variant="hero" />
      </motion.div>

      {/* GPS Warning if needed */}
      {(permission === 'denied' || (permission === 'prompt' && !position)) && (
        <motion.div variants={itemVariants} style={{ background: '#fef2f2', border: '1px solid #f87171', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx={12} cy={9} r={3} /></svg>
          {permission === 'denied' ? t.locationDenied : t.waitingGps}
        </motion.div>
      )}

      {/* ─── Gamified Stats Widget ───────────────────────────────────────── */}
      <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: 'white', borderRadius: '1.25rem', padding: '1.25rem', border: '1px solid var(--surface-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.5rem' }}>{t.dailyTarget}</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 900, lineHeight: 1, color: 'var(--color-primary-600)', letterSpacing: '-0.05em' }}>{todayVisits}</span>
            <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600, paddingBottom: '0.3rem' }}>/ {dailyTarget}</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: 'var(--surface-input)', borderRadius: '4px', overflow: 'hidden' }}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ height: '100%', background: 'linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600))', borderRadius: '4px' }} 
            />
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: 600 }}>
            {dailyTarget - todayVisits > 0 ? `${dailyTarget - todayVisits} ${t.moreVisitsToHitTarget}` : t.targetAchieved}
          </p>
        </div>

        <div style={{ background: 'white', borderRadius: '1.25rem', padding: '1.25rem', border: '1px solid var(--surface-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: '12px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              👤
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{todayContacts}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t.newContacts}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              🏆
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{contacts?.length ?? 0}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t.totalBase}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Quick Actions Grid ──────────────────────────────────────────── */}
      <motion.div variants={itemVariants} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{t.quickActions}</h3>
      </motion.div>
      
      <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        {activeVisit ? (
          <Link href={`/visit/${activeVisit.clientId}`} style={{ textDecoration: 'none' }}>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '1rem', padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ background: '#3b82f6', color: 'white', width: 40, height: 40, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', marginBottom: '1rem', boxShadow: '0 4px 10px rgba(59,130,246,0.3)' }}>
                📍
              </div>
              <div>
                <p style={{ fontWeight: 800, color: '#1e3a8a', fontSize: '0.95rem' }}>{t.resumeVisit}</p>
                <p style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600, marginTop: '0.2rem' }}>{t.started} {new Date(activeVisit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </motion.div>
          </Link>
        ) : (
          <Link href="/visit" style={{ textDecoration: 'none', opacity: isOnShift ? 1 : 0.6, pointerEvents: isOnShift ? 'auto' : 'none' }}>
            <motion.div whileHover={{ scale: isOnShift ? 1.02 : 1 }} whileTap={{ scale: isOnShift ? 0.98 : 1 }} style={{ background: 'white', border: '1px solid var(--surface-border)', borderRadius: '1rem', padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
              <div style={{ background: 'var(--surface-input)', color: '#0f172a', width: 40, height: 40, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', marginBottom: '1rem' }}>
                📍
              </div>
              <div>
                <p style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>{t.checkIn}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.2rem' }}>{t.startNewFieldVisit}</p>
              </div>
            </motion.div>
          </Link>
        )}

        <Link href="/contacts/new" style={{ textDecoration: 'none' }}>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} style={{ background: 'white', border: '1px solid var(--surface-border)', borderRadius: '1rem', padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', width: 40, height: 40, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', marginBottom: '1rem' }}>
              👤
            </div>
            <div>
              <p style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>{t.addContact}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.2rem' }}>{t.registerNewPerson}</p>
            </div>
          </motion.div>
        </Link>
      </motion.div>

      {/* Gamified Survey Card */}
      <motion.div variants={itemVariants} style={{ marginBottom: '2rem' }}>
        <Link href="/survey" style={{ textDecoration: 'none' }}>
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} style={{ 
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', 
            borderRadius: '1.25rem', padding: '1.5rem', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 10px 25px -5px rgba(49, 46, 129, 0.4)'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a5b4fc', background: 'rgba(165, 180, 252, 0.2)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{t.gamifiedMode}</span>
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0.25rem 0' }}>{t.healthSurvey}</h3>
              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500, lineHeight: 1.4, maxWidth: '90%' }}>
                {t.surveyDesc}
              </p>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </div>
          </motion.div>
        </Link>
      </motion.div>
      
      {/* ─── Recent Activity Feed (Empty State for now) ──────────────────── */}
      <motion.div variants={itemVariants}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{t.recentActivity}</h3>
          <Link href="/history" style={{ fontSize: '0.8rem', color: 'var(--color-primary-600)', fontWeight: 700, textDecoration: 'none' }}>{t.viewAll}</Link>
        </div>
        
        {(!visits || visits.length === 0) ? (
          <div style={{ background: 'white', borderRadius: '1rem', border: '1px solid var(--surface-border)', padding: '2rem 1rem', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, background: 'var(--surface-input)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.25rem' }}>⏳</div>
            <p style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>{t.noRecentActivity}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.noRecentActivityDesc}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {visits.sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime()).slice(0, 3).map((visit) => {
              const visitDate = new Date(visit.checkInAt);
              return (
                <div key={visit.clientId} style={{ background: 'white', borderRadius: '1rem', border: '1px solid var(--surface-border)', padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: 40, height: 40, background: '#eff6ff', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                    📍
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>{t.panchayatVisit}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{visitDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {visit.checkOutAt ? t.completed : t.ongoing}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

    </motion.div>
  );
}
