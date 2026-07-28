'use client';

import { useEffect, useState } from 'react';
import type { GpsPosition } from '@/lib/geo/useGeolocation';
import { motion } from 'framer-motion';

// Haversine formula for distance
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; // Distance in km
}

export function CurrentLocationBanner({ position, variant = 'default' }: { position: GpsPosition | null, variant?: 'default' | 'hero' }) {
  const [blockName, setBlockName] = useState<string | null>(null);

  useEffect(() => {
    if (!position) return;
    
    // Fetch panchayats data to do client-side reverse geocoding to find the Block
    fetch('/data/panchayats.json')
      .then(res => res.json())
      .then((data: any[]) => {
        let minDist = Infinity;
        let nearestBlock = null;
        for (const p of data) {
          if (p.centroidLat && p.centroidLng) {
            const dist = getDistance(position.lat, position.lng, p.centroidLat, p.centroidLng);
            if (dist < minDist) {
              minDist = dist;
              nearestBlock = p.block;
            }
          }
        }
        setBlockName(nearestBlock);
      })
      .catch(console.error);
  }, [position]);

  if (!position) return null;

  const isHero = variant === 'hero';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        background: isHero ? 'rgba(255, 255, 255, 0.1)' : 'rgba(99, 102, 241, 0.05)',
        border: isHero ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(99, 102, 241, 0.2)',
        borderRadius: '1rem',
        padding: '0.6rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: isHero ? '0' : '1.5rem',
        marginTop: isHero ? '1rem' : '0',
        backdropFilter: isHero ? 'blur(10px)' : 'none',
        boxShadow: isHero ? 'none' : '0 2px 8px rgba(99, 102, 241, 0.05)'
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: isHero ? 'rgba(255, 255, 255, 0.2)' : 'rgba(99, 102, 241, 0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isHero ? 'white' : 'var(--color-primary-600)'
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '0.65rem', color: isHero ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Current Location
        </span>
        <span style={{ fontSize: '0.9rem', color: isHero ? 'white' : '#0f172a', fontWeight: 800 }}>
          {blockName ? `${blockName} Block` : 'Detecting block...'}
        </span>
      </div>
    </motion.div>
  );
}
