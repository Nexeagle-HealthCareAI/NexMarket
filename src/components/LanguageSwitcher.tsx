'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LanguageSwitcher() {
  const router = useRouter();
  const [currentLang, setCurrentLang] = useState('en');

  useEffect(() => {
    const match = document.cookie.match(new RegExp('(^| )NEXT_LOCALE=([^;]+)'));
    if (match) {
      setCurrentLang(match[2]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const locale = e.target.value;
    setCurrentLang(locale);
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
    router.refresh(); // Tell Next.js Server Components to re-render
  };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select
        value={currentLang}
        onChange={handleChange}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: '9999px',
          padding: '0.35rem 1.7rem 0.35rem 0.85rem',
          fontSize: '0.75rem',
          fontWeight: 700,
          color: 'var(--color-primary-600)',
          cursor: 'pointer',
          outline: 'none',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 8px rgba(99, 102, 241, 0.05)',
        }}
      >
        <option value="en">EN</option>
        <option value="hi">HI</option>
        <option value="hinglish">HIN</option>
      </select>
      <svg 
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" 
        strokeLinecap="round" strokeLinejoin="round" 
        style={{ position: 'absolute', right: '0.55rem', pointerEvents: 'none', color: 'var(--color-primary-600)' }}
      >
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </div>
  );
}
