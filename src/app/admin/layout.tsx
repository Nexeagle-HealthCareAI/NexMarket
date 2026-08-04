'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { logout as apiLogout, setSessionExpiredHandler } from '@/lib/sync/api-client';
import { useAgentStore } from '@/store/agent-store';

const adminNavItems = [
  { href: '/admin/map', label: 'Live Map', icon: '🗺️' },
  { href: '/admin/assignments', label: 'Tasks', icon: '📋' },
  { href: '/admin/sync', label: 'Sync', icon: '📡' },
  { href: '/admin/agents', label: 'Agents', icon: '👥' },
  { href: '/admin/duplicates', label: 'Duplicates', icon: '⚠️' },
  { href: '/admin/reports', label: 'Reports', icon: '📊' },
  { href: '/admin/surveys', label: 'Surveys', icon: '📋' },
  { href: '/admin/pipeline', label: 'Contact Management', icon: '🗂️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const agentId = useAgentStore((s) => s.agentId);
  const role = useAgentStore((s) => s.role);
  const hasHydrated = useAgentStore((s) => s.hasHydrated);
  const clearAuth = useAgentStore((s) => s.clearAuth);

  const handleLogout = () => {
    // Best-effort: revoke the session server-side and clear the httpOnly
    // cookies — clearAuth() alone only wipes Zustand/localStorage.
    void apiLogout().catch(() => {});
    clearAuth();
    router.push('/');
  };

  useEffect(() => {
    // A 401 that survives a refresh attempt means the session is genuinely
    // gone — clear local state and bounce to /login rather than leaving the
    // dashboard silently stuck showing stale data.
    setSessionExpiredHandler(() => {
      clearAuth();
      router.replace('/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [clearAuth, router]);

  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setIsCollapsed(true);
    };
    // Initial check
    if (typeof window !== 'undefined') handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Wait for the persisted session to rehydrate before deciding anything —
    // agentId is briefly null on every fresh load even for an already-logged
    // -in admin.
    if (!hasHydrated) return;

    if (!agentId) {
      router.replace('/login');
      return;
    }

    // The API now rejects non-Admin roles on every admin endpoint (403) — redirect
    // here too so a non-admin agent sees a clean bounce instead of a page full of
    // permission-error banners.
    if (role && role.toLowerCase() !== 'admin') {
      router.replace('/home');
    }
  }, [hasHydrated, agentId, role, router]);

  const sidebarWidth = isCollapsed ? 80 : 260;

  if (!hasHydrated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: 'var(--color-primary-500)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#f8fafc', overflow: 'hidden' }}>
      
      {/* Mobile Backdrop Overlay */}
      <AnimatePresence>
        {isMobile && !isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCollapsed(true)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', zIndex: 45 }}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isMobile ? 260 : (isCollapsed ? 80 : 260),
          x: isMobile && isCollapsed ? -260 : 0
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{
          background: '#0f172a',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 50,
          boxShadow: '4px 0 24px rgba(0,0,0,0.05)',
          overflow: 'hidden'
        }}
      >
        {/* Sidebar Header */}
        <div style={{ 
          height: '70px', 
          padding: '0 1.5rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '1rem', 
          borderBottom: '1px solid rgba(255,255,255,0.05)' 
        }}>

          <AnimatePresence>
            {!isCollapsed && (
              <motion.div 
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}
              >
                <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: 0, letterSpacing: '-0.02em' }}>
                  NexMarket
                </h1>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Links */}
        <nav style={{ flex: 1, padding: isCollapsed ? '1.5rem 0.5rem' : '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', overflowY: 'auto', overflowX: 'hidden' }}>
          <AnimatePresence>
            {!isCollapsed && (
              <motion.p 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', paddingLeft: '0.75rem', overflow: 'hidden', whiteSpace: 'nowrap' }}
              >
                Management
              </motion.p>
            )}
          </AnimatePresence>
          
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                onClick={() => { if (isMobile) setIsCollapsed(true); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: (!isMobile && isCollapsed) ? 'center' : 'flex-start',
                  gap: '0.75rem',
                  padding: isCollapsed ? '0.75rem' : '0.75rem 1rem',
                  borderRadius: '8px',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: isActive ? '#fff' : '#94a3b8',
                  background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                  transition: 'background 0.2s ease, color 0.2s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                <span style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</span>
                <AnimatePresence>
                  {(isMobile || !isCollapsed) && (
                    <motion.span 
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: 'hidden' }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div style={{ padding: isCollapsed ? '1rem 0.5rem' : '1.5rem 1rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link
            href="/home"
            title="Agent App"
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '0.75rem',
              padding: '0.75rem', borderRadius: '8px', background: '#1e293b', color: '#e2e8f0',
              fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none',
              transition: 'background 0.2s', border: '1px solid rgba(255,255,255,0.05)',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📱</span>
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  Agent App
                </motion.span>
              )}
            </AnimatePresence>
          </Link>

          <button
            onClick={handleLogout}
            title="Sign Out"
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '0.75rem',
              padding: '0.75rem', borderRadius: '8px', background: 'transparent', color: '#ef4444',
              fontSize: '0.85rem', fontWeight: 600, border: 'none', cursor: 'pointer',
              transition: 'background 0.2s', whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </span>
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  Sign Out
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>

      {/* Sidebar Toggle Button (Premium Edge Button) */}
      <motion.button
        initial={false}
        animate={{ left: sidebarWidth - 14 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={() => setIsCollapsed(!isCollapsed)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        style={{
          display: isMobile ? 'none' : 'flex',
          position: 'fixed',
          top: '21px', // Aligns vertically with header elements
          width: '28px',
          height: '28px',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: '50%',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 60,
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          color: '#475569'
        }}
      >
        {isCollapsed ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        )}
      </motion.button>

      {/* Main Content Area */}
      <motion.main 
        initial={false}
        animate={{ marginLeft: isMobile ? 0 : (isCollapsed ? 80 : 260) }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}
      >
        {/* Top bar */}
        <header style={{ 
          height: '70px', 
          background: 'rgba(255, 255, 255, 0.95)', 
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
        }}>
          {/* Left Side: Time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {isMobile && (
              <button 
                onClick={() => setIsCollapsed(false)} 
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem', color: '#0f172a' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}>
              <span style={{ fontSize: '1rem' }}>🕒</span>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {currentTime ? currentTime : '...'}
              </div>
            </div>
          </div>

          {/* Right Side: Language & Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.75rem' : '1.5rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.25rem', borderRadius: '6px', border: '1px solid #e2e8f0', display: isMobile ? 'none' : 'block' }}>
              <LanguageSwitcher />
            </div>
            
            <div style={{ width: 1, height: 24, background: '#e2e8f0', display: isMobile ? 'none' : 'block' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {!isMobile && (
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>Admin User</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>admin@nexmarket.com</p>
                </div>
              )}
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#0f172a', fontSize: '0.85rem' }}>
                AD
              </div>
            </div>
          </div>
        </header>

        <div style={{ padding: '2rem', flex: 1, maxWidth: 1600, width: '100%', margin: '0 auto' }}>
          {children}
        </div>
      </motion.main>
    </div>
  );
}
