'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { useOutboxCount } from '@/lib/db';

const leftItems = [
  {
    href: '/home',
    label: 'Home',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const rightItems = [
  {
    href: '/visit',
    label: 'Visit',
    showBadge: true,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/my-task',
    label: 'My Block',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const outboxCount = useOutboxCount();

  if (pathname.startsWith('/onboarding')) {
    return null;
  }

  const isAddContact = pathname.startsWith('/contacts/new');

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-container">
        {leftItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
              aria-label={item.label}
            >
              <div className="nav-icon-wrapper">
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-bubble"
                    className="nav-item-bubble"
                    transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                  />
                )}
                <span className="nav-icon" style={{ position: 'relative', zIndex: 2 }}>
                  {item.icon}
                </span>
              </div>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}

        <div className="nav-fab-wrapper">
          <Link href="/contacts/new" style={{ textDecoration: 'none', display: 'block' }} aria-label="Add new contact">
            <motion.div
              className="nav-fab"
              whileTap={{ scale: 0.9 }}
              animate={isAddContact ? { scale: 0.88, rotate: 45 } : { scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </motion.div>
          </Link>
          <span className="nav-fab-label">Add</span>
        </div>

        {rightItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const sb = (item as any).showBadge;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
              aria-label={item.label}
            >
              <div className="nav-icon-wrapper">
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-bubble"
                    className="nav-item-bubble"
                    transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                  />
                )}
                <span className="nav-icon" style={{ position: 'relative', zIndex: 2 }}>
                  {item.icon}
                  {sb && outboxCount && outboxCount > 0 ? (
                    <span className="nav-badge">{outboxCount > 99 ? '99+' : outboxCount}</span>
                  ) : null}
                </span>
              </div>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
