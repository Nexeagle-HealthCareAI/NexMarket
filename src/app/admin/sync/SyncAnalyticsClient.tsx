'use client';

import React, { useEffect, useState } from 'react';
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
import { getSyncAnalytics, type SyncAnalyticsDto } from '@/lib/sync/api-client';

const EMPTY_ANALYTICS: SyncAnalyticsDto = {
  recordsSyncedToday: 0,
  activeOfficersToday: 0,
  avgSyncDelayMinutesToday: 0,
  recordsSyncedThisWeek: 0,
  hourlyBreakdown: [],
};

function formatDelay(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.4, ease: "easeOut" } }
};

export default function SyncAnalyticsClient() {
  const [data, setData] = useState<SyncAnalyticsDto>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getSyncAnalytics()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sync analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  // There's no server-side concept of "items still queued on a device" or
  // "failed sync attempts" — those only ever exist on the device itself,
  // before (or if a sync never manages to reach) the server. This used to
  // show a "Pending in Queue" / "Sync Failures" pair that was 100% fabricated
  // (a literal "Mock Sync Data" array, hardcoded and never changing). Every
  // number here is instead something the server can actually observe.
  const stats = [
    { title: 'Records Synced Today', value: String(data.recordsSyncedToday), color: '#10b981' },
    { title: 'Active Officers Today', value: String(data.activeOfficersToday), color: '#6366f1' },
    { title: 'Avg Sync Delay', value: formatDelay(data.avgSyncDelayMinutesToday), color: '#f59e0b' },
    { title: 'Synced This Week', value: String(data.recordsSyncedThisWeek), color: '#38bdf8' },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
    >
      <motion.div variants={itemVariants}>
        <h1 style={{ fontSize: '1.8rem', color: '#0f172a', marginBottom: '0.2rem' }}>Sync Analytics</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Real throughput and sync delay from actual synced records — updates as agents sync.</p>
      </motion.div>

      {error && (
        <motion.div variants={itemVariants} style={{ background: 'rgba(239,68,68,0.05)', borderLeft: '4px solid #ef4444', borderRadius: '8px', padding: '1rem' }}>
          <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: 0 }}>{error}</p>
        </motion.div>
      )}

      {/* Metric Cards */}
      <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
        {stats.map((stat, i) => (
          <div key={i} style={{
            background: 'white', padding: '1.25rem', borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
            border: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '0.5rem'
          }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{stat.title}</span>
            <span style={{ fontSize: '1.8rem', fontWeight: 800, color: stat.color }}>{stat.value}</span>
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
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: '#1e293b' }}>Sync Throughput Today (Records/Hour)</h3>
          {data.hourlyBreakdown.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1rem' }}>Nothing synced yet today.</p>
          ) : (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={data.hourlyBreakdown} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} allowDecimals={false} />
                  <Tooltip
                    cursor={{fill: '#f1f5f9'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: '1rem' }} />
                  <Bar dataKey="visits" name="Visits" stackId="a" fill="#6366f1" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="contacts" name="Contacts" stackId="a" fill="#10b981" />
                  <Bar dataKey="referrals" name="Referrals" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>

        {/* Sync Delay Chart */}
        <motion.div variants={itemVariants} style={{
          background: 'white', padding: '1.5rem', borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid var(--surface-border)'
        }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: '#1e293b' }}>Avg Sync Delay by Hour (minutes)</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.15rem' }}>
            Time between when an agent recorded something and when it reached the server — not network latency, since agents work offline for stretches.
          </p>
          {data.hourlyBreakdown.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1rem' }}>Nothing synced yet today.</p>
          ) : (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.hourlyBreakdown} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    formatter={(value: any) => [`${value}m`, 'Avg Delay']}
                  />
                  <Line type="monotone" dataKey="avgDelayMinutes" stroke="#ec4899" strokeWidth={3} dot={{r: 4, fill: '#ec4899', strokeWidth: 2, stroke: 'white'}} activeDot={{r: 6}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>

      </div>
    </motion.div>
  );
}
