'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { motion, type Variants } from 'framer-motion';

// Mock Sync Data for Visualization
const syncVolumeData = [
  { time: '08:00', contacts: 12, visits: 34, referrals: 2 },
  { time: '09:00', contacts: 19, visits: 45, referrals: 5 },
  { time: '10:00', contacts: 8, visits: 22, referrals: 1 },
  { time: '11:00', contacts: 24, visits: 56, referrals: 8 },
  { time: '12:00', contacts: 30, visits: 67, referrals: 12 },
  { time: '13:00', contacts: 15, visits: 40, referrals: 4 },
  { time: '14:00', contacts: 28, visits: 51, referrals: 9 },
];

const syncLatencyData = [
  { time: '08:00', latencyMs: 120 },
  { time: '09:00', latencyMs: 145 },
  { time: '10:00', latencyMs: 110 },
  { time: '11:00', latencyMs: 250 }, // spike
  { time: '12:00', latencyMs: 135 },
  { time: '13:00', latencyMs: 125 },
  { time: '14:00', latencyMs: 115 },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.4, ease: "easeOut" } }
};

export default function SyncAnalyticsClient() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
    >
      <motion.div variants={itemVariants}>
        <h1 style={{ fontSize: '1.8rem', color: '#0f172a', marginBottom: '0.2rem' }}>Sync Analytics</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Monitor real-time system performance and offline sync throughput.</p>
      </motion.div>

      {/* Metric Cards */}
      <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {[
          { title: 'Total Synced Today', value: '435', trend: '+12%', color: '#10b981' },
          { title: 'Pending in Queue', value: '18', trend: '-5%', color: '#f59e0b' },
          { title: 'Avg Latency', value: '142ms', trend: '-10ms', color: '#6366f1' },
          { title: 'Sync Failures', value: '0', trend: '0%', color: '#ef4444' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: 'white', padding: '1.25rem', borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
            border: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '0.5rem'
          }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{stat.title}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{stat.value}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: stat.color, background: `${stat.color}20`, padding: '2px 6px', borderRadius: '4px' }}>
                {stat.trend}
              </span>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
        
        {/* Throughput Chart */}
        <motion.div variants={itemVariants} style={{
          background: 'white', padding: '1.5rem', borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid var(--surface-border)'
        }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: '#1e293b' }}>Sync Throughput (Records/Hour)</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={syncVolumeData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '1rem' }} />
                <Bar dataKey="visits" stackId="a" fill="#6366f1" radius={[0, 0, 4, 4]} />
                <Bar dataKey="contacts" stackId="a" fill="#10b981" />
                <Bar dataKey="referrals" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Latency Chart */}
        <motion.div variants={itemVariants} style={{
          background: 'white', padding: '1.5rem', borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid var(--surface-border)'
        }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: '#1e293b' }}>Network Latency (ms)</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={syncLatencyData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} domain={[0, 300]} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Line type="monotone" dataKey="latencyMs" stroke="#ec4899" strokeWidth={3} dot={{r: 4, fill: '#ec4899', strokeWidth: 2, stroke: 'white'}} activeDot={{r: 6}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
}
