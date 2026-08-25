'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getReportsSummary, getSyncAnalytics, type ReportSummaryDto, type SyncAnalyticsDto } from '@/lib/sync/api-client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

const COLORS = ['#10b981', '#38bdf8', '#c084fc', '#f59e0b', '#f472b6', '#94a3b8'];

const EMPTY_SUMMARY: ReportSummaryDto = {
  totalContacts: 0, ashaWorkers: 0, rmpDoctors: 0, wardMembers: 0, medicineShops: 0,
  mukhiyas: 0, prominentPersons: 0, labs: 0, nursingHomes: 0, independentDoctors: 0, hospitals: 0, others: 0,
  totalVisits: 0, totalReferrals: 0, convertedReferrals: 0, conversionRatePct: 0, blocks: [],
};

export default function ReportsClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const [districtFilter, setDistrictFilter] = useState<string>('All');
  const [summary, setSummary] = useState<ReportSummaryDto>(EMPTY_SUMMARY);
  const [syncAnalytics, setSyncAnalytics] = useState<SyncAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const [summaryResult, analyticsResult] = await Promise.allSettled([
        getReportsSummary(districtFilter),
        getSyncAnalytics()
      ]);

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value);
      } else {
        setError(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Failed to load summary reports.');
      }

      if (analyticsResult.status === 'fulfilled') {
        setSyncAnalytics(analyticsResult.value);
      } else {
        console.warn('Analytics load failed:', analyticsResult.reason);
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, districtFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Data for Funnel Chart
  const funnelData = [
    { name: 'Total Visits', value: summary.totalVisits, fill: '#6366f1' },
    { name: 'Contacts Logged', value: summary.totalContacts, fill: '#38bdf8' },
    { name: 'Referrals Generated', value: summary.totalReferrals, fill: '#a855f7' },
    { name: 'Converted Patients', value: summary.convertedReferrals, fill: '#10b981' },
  ];

  // Data for Role Pie Chart
  const roleData = [
    { name: 'ASHA Workers', value: summary.ashaWorkers },
    { name: 'RMP Doctors', value: summary.rmpDoctors },
    { name: 'Ward Members', value: summary.wardMembers },
    { name: 'Medicine Shops', value: summary.medicineShops },
    { name: 'Mukhiya', value: summary.mukhiyas },
    { name: 'Prominent Persons', value: summary.prominentPersons },
    { name: 'Labs', value: summary.labs },
    { name: 'Nursing Homes', value: summary.nursingHomes },
    { name: 'Independent Doctors', value: summary.independentDoctors },
    { name: 'Hospitals', value: summary.hospitals },
    { name: 'Others', value: summary.others },
  ];

  // Data for Territory Bar Chart
  const territoryData = summary.blocks.map((b) => ({
    name: b.block,
    Contacts: b.asha + b.rmp + b.ward + b.med + b.mukhiya + b.prominent + b.lab + b.nursingHome + b.independentDoctor + b.hospital + b.other,
    Referrals: b.referrals,
    Converted: b.converted,
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>📊 Analytics & Dashboards</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Visualize field performance and territory metrics.
          </p>
        </div>

        {/* District Filter Selector */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>District:</span>
          {['All', 'Katihar', 'Purnia', 'Araria', 'Kishanganj', 'Supaul', 'Uttar Dinajpur'].map((dist) => (
            <button
              key={dist}
              onClick={() => setDistrictFilter(dist)}
              className={`btn btn-sm ${districtFilter === dist ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '0.4rem 0.85rem' }}
            >
              {dist === 'All' ? '🌐 All Districts' : dist}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {/* Top Overview KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-primary-600)', fontWeight: 700 }}>TOTAL VISITS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.totalVisits}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>TOTAL CONTACTS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.totalContacts}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#9333ea', fontWeight: 700 }}>CLIENT REFERRALS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.totalReferrals}</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 700 }}>CONVERSION RATE</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.conversionRatePct}%</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>Loading analytics…</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
            {/* Funnel Chart */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>📈 Conversion Funnel</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--surface-border)" />
                    <XAxis type="number" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={12} width={100} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.05)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Role Pie Chart */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>👥 Role Distribution</h3>
              <div style={{ width: '100%', height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <ResponsiveContainer width="100%" height="80%">
                  <PieChart>
                    <Pie
                      data={roleData}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {roleData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Time-Series Trends */}
            <div className="card" style={{ padding: '1.25rem', gridColumn: '1 / -1' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>📈 Today's Hourly Trends (System-wide)</h3>
              {!syncAnalytics || syncAnalytics.hourlyBreakdown.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                  No hourly data available yet.
                </p>
              ) : (
                <div style={{ width: '100%', height: 350 }}>
                  <ResponsiveContainer>
                    <LineChart data={syncAnalytics.hourlyBreakdown} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-border)" />
                      <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={12} />
                      <YAxis stroke="var(--text-muted)" fontSize={12} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                      <Line type="monotone" dataKey="visits" stroke="#6366f1" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Visits" />
                      <Line type="monotone" dataKey="contacts" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Contacts" />
                      <Line type="monotone" dataKey="referrals" stroke="#a855f7" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Referrals" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Territory Comparison */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>📍 Block-wise Performance Comparison</h3>
            {territoryData.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                No field activity recorded yet for this filter.
              </p>
            ) : (
              <div style={{ width: '100%', height: 400 }}>
                <ResponsiveContainer>
                  <BarChart data={territoryData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-border)" />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.05)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="Contacts" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Referrals" fill="#a855f7" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Converted" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
