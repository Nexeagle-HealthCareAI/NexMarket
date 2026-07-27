'use client';

import { useState, useMemo } from 'react';
import { MOCK_REPORT_SUMMARY } from '@/lib/admin/mock-data';

interface BlockReport {
  district: string;
  block: string;
  agents: number;
  asha: number;
  rmp: number;
  ward: number;
  med: number;
  visits: number;
  referrals: number;
  converted: number;
}

const BLOCK_REPORTS: BlockReport[] = [
  { district: 'Katihar', block: 'Katihar Urban & Rural', agents: 3, asha: 18, rmp: 14, ward: 6, med: 5, visits: 12, referrals: 10, converted: 5 },
  { district: 'Katihar', block: 'Manihari', agents: 2, asha: 12, rmp: 9, ward: 4, med: 3, visits: 8, referrals: 7, converted: 3 },
  { district: 'Purnia', block: 'Purnia East', agents: 4, asha: 15, rmp: 11, ward: 5, med: 4, visits: 10, referrals: 8, converted: 3 },
  { district: 'Purnia', block: 'Baisi South', agents: 2, asha: 7, rmp: 6, ward: 3, med: 3, visits: 5, referrals: 3, converted: 1 },
  { district: 'Araria', block: 'Forbesganj', agents: 2, asha: 4, rmp: 3, ward: 2, med: 2, visits: 2, referrals: 1, converted: 0 },
  { district: 'Supaul', block: 'Supaul', agents: 1, asha: 2, rmp: 1, ward: 2, med: 1, visits: 1, referrals: 0, converted: 0 },
];

export default function ReportsClient() {
  const [districtFilter, setDistrictFilter] = useState<string>('All');

  const filteredBlocks = useMemo(() => {
    if (districtFilter === 'All') return BLOCK_REPORTS;
    return BLOCK_REPORTS.filter((b) => b.district === districtFilter);
  }, [districtFilter]);

  const summary = useMemo(() => {
    if (districtFilter === 'All') return MOCK_REPORT_SUMMARY;
    const res = { totalContacts: 0, ashaWorkers: 0, rmpDoctors: 0, wardMembers: 0, medicineShops: 0, totalVisits: 0, totalReferrals: 0, convertedReferrals: 0, conversionRatePct: 0 };
    filteredBlocks.forEach((b) => {
      res.ashaWorkers += b.asha;
      res.rmpDoctors += b.rmp;
      res.wardMembers += b.ward;
      res.medicineShops += b.med;
      res.totalContacts += b.asha + b.rmp + b.ward + b.med;
      res.totalVisits += b.visits;
      res.totalReferrals += b.referrals;
      res.convertedReferrals += b.converted;
    });
    res.conversionRatePct = res.totalReferrals > 0 ? Number(((res.convertedReferrals / res.totalReferrals) * 100).toFixed(1)) : 0;
    return res;
  }, [districtFilter, filteredBlocks]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>📊 Seemanchal Field Analytics & Reports</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Comprehensive block-wise telemetry on contact collection, visit coverage, and patient referral conversions.
          </p>
        </div>

        {/* District Filter Selector */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>District:</span>
          {['All', 'Katihar', 'Purnia', 'Araria', 'Supaul'].map((dist) => (
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

      {/* Top Overview KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-primary-600)', fontWeight: 700 }}>TOTAL CONTACTS LOGGED</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.totalContacts}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Across {filteredBlocks.length} blocks</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>ASHA WORKERS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.ashaWorkers}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Primary grassroots network</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(56,189,248,0.08)', borderColor: 'rgba(56,189,248,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 700 }}>RMP DOCTORS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.rmpDoctors}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Rural medical practitioners</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#9333ea', fontWeight: 700 }}>PATIENT REFERRALS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.totalReferrals}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Referred to hospital</div>
        </div>
        <div className="card" style={{ padding: '1rem', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 700 }}>HOSPITAL CONVERSION RATE</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>{summary.conversionRatePct}%</div>
          <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.2rem' }}>✅ {summary.convertedReferrals} admitted / treated</div>
        </div>
      </div>

      {/* Role Breakdown Progress Bar */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>👥 Contact Role Distribution</h3>
        <div style={{ display: 'flex', height: 16, borderRadius: '9999px', overflow: 'hidden', background: 'var(--surface-input)', marginBottom: '0.75rem', border: '1px solid var(--surface-border)' }}>
          <div style={{ width: `${(summary.ashaWorkers / summary.totalContacts) * 100}%`, background: '#10b981' }} title="ASHA Workers" />
          <div style={{ width: `${(summary.rmpDoctors / summary.totalContacts) * 100}%`, background: '#38bdf8' }} title="RMP Doctors" />
          <div style={{ width: `${(summary.wardMembers / summary.totalContacts) * 100}%`, background: '#c084fc' }} title="Ward Members" />
          <div style={{ width: `${(summary.medicineShops / summary.totalContacts) * 100}%`, background: '#f59e0b' }} title="Medicine Shops" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>🟢 ASHA Workers: <strong>{summary.ashaWorkers}</strong> ({Math.round((summary.ashaWorkers / summary.totalContacts) * 100)}%)</span>
          <span>🔵 RMP Doctors: <strong>{summary.rmpDoctors}</strong> ({Math.round((summary.rmpDoctors / summary.totalContacts) * 100)}%)</span>
          <span>🟣 Ward Members: <strong>{summary.wardMembers}</strong> ({Math.round((summary.wardMembers / summary.totalContacts) * 100)}%)</span>
          <span>🟡 Medicine Shops: <strong>{summary.medicineShops}</strong> ({Math.round((summary.medicineShops / summary.totalContacts) * 100)}%)</span>
        </div>
      </div>

      {/* Block-wise Breakdown Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--surface-border)', background: 'var(--surface-card-hover)' }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>📍 Block-wise Performance Breakdown</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: 'var(--surface-card-hover)', borderBottom: '1px solid var(--surface-border)', color: 'var(--text-secondary)', fontSize: '0.78rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '0.85rem 1rem' }}>District & Block</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Agents</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>ASHA</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>RMP</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Ward</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Med Shop</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Visits</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Referrals</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Conversion Rate</th>
            </tr>
          </thead>
          <tbody>
            {filteredBlocks.map((b, i) => {
              const rate = b.referrals > 0 ? Math.round((b.converted / b.referrals) * 100) : 0;
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.block}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)' }}>{b.district} District</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>{b.agents}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', color: '#10b981', fontWeight: 600 }}>{b.asha}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', color: '#38bdf8', fontWeight: 600 }}>{b.rmp}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', color: '#c084fc' }}>{b.ward}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', color: '#f59e0b' }}>{b.med}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontWeight: 600 }}>{b.visits}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>{b.referrals}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, color: rate >= 40 ? '#10b981' : rate > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                        {rate}%
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({b.converted}/{b.referrals})</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
