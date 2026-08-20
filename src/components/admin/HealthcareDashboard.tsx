import React, { useEffect, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Legend, AreaChart, Area 
} from 'recharts';
import { Activity, TrendingUp, AlertTriangle, Users, DollarSign, MapPin } from 'lucide-react';
import { useAgentStore } from '@/store/agent-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export interface DashboardKpis {
  totalSurveySample: number;
  outflowLeakageRate: number;
  careAbandonmentRate: number;
  distressFinancingRate: number;
  rmpTeleTriageReadiness: number;
  annualEconomicLeakageCrores: number;
  estimatedMonthlyOutflowCases: number;
}

export interface PricingCurvePoint {
  packagePrice: number;
  priceTierName: string;
  conversionRate: number;
  estimatedMonthlyPatients: number;
  projectedMonthlyRevenueLakhs: number;
}

export const HealthcareDashboard: React.FC = () => {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [pricingData, setPricingData] = useState<PricingCurvePoint[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<string>('Kishanganj');
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  
  // Need token to call the protected Admin API
  const getAccessToken = () => {
    return document.cookie.split('; ').find(row => row.startsWith('access_token='))?.split('=')[1];
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedDistrict, selectedBlock]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const headers = {
        'Authorization': `Bearer ${token}`
      };

      const kpiUrl = new URL(`${API_BASE_URL}/api/v1/HealthcareDashboard/kpis`);
      if (selectedDistrict) kpiUrl.searchParams.append('district', selectedDistrict);
      if (selectedBlock) kpiUrl.searchParams.append('block', selectedBlock);

      const pricingUrl = new URL(`${API_BASE_URL}/api/v1/HealthcareDashboard/pricing-curve`);

      const [kpiRes, pricingRes] = await Promise.all([
        fetch(kpiUrl.toString(), { headers }),
        fetch(pricingUrl.toString(), { headers })
      ]);

      if (kpiRes.ok && pricingRes.ok) {
        setKpis(await kpiRes.json());
        setPricingData(await pricingRes.json());
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !kpis) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading Healthcare Intelligence Engine...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header & Filter Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Healthcare Feasibility Engine
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
            Real-time medical gap analysis, patient outflow leakage, and revenue optimization
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <select 
            value={selectedDistrict} 
            onChange={(e) => { setSelectedDistrict(e.target.value); setSelectedBlock(''); }}
            style={{ padding: '0.5rem 0.75rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Districts</option>
            <option value="Kishanganj">Kishanganj (Bihar)</option>
            <option value="Uttar Dinajpur">Uttar Dinajpur (WB)</option>
            <option value="Purnea">Purnea (Bihar)</option>
          </select>

          <select 
            value={selectedBlock} 
            onChange={(e) => setSelectedBlock(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Blocks</option>
            {selectedDistrict === 'Kishanganj' && (
              <>
                <option value="Bahadurganj">Bahadurganj</option>
                <option value="Thakurganj">Thakurganj</option>
                <option value="Kishanganj Sadar">Kishanganj Sadar</option>
                <option value="Kochadhaman">Kochadhaman</option>
              </>
            )}
            {selectedDistrict === 'Uttar Dinajpur' && (
              <>
                <option value="Islampur">Islampur</option>
                <option value="Chopra">Chopra</option>
                <option value="Goalpokhar">Goalpokhar</option>
              </>
            )}
          </select>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        
        {/* Card 1: Regional Outflow */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Patient Outflow Leakage</span>
            <TrendingUp size={20} color="#f43f5e" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{kpis?.outflowLeakageRate}%</div>
          <p style={{ fontSize: '0.8rem', color: '#e11d48', marginTop: '0.25rem', fontWeight: 500, margin: 0 }}>
            ~{kpis?.estimatedMonthlyOutflowCases} surgical cases/mo leaving region
          </p>
        </div>

        {/* Card 2: Annual Economic Drain */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Annual Economic Drain</span>
            <DollarSign size={20} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>₹{kpis?.annualEconomicLeakageCrores} Cr</div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem', margin: 0 }}>
            Total medical + travel expenditure leaving
          </p>
        </div>

        {/* Card 3: RMP Tele-Triage Readiness */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>RMP Hotline Conversion</span>
            <Users size={20} color="#10b981" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{kpis?.rmpTeleTriageReadiness}%</div>
          <p style={{ fontSize: '0.8rem', color: '#059669', marginTop: '0.25rem', fontWeight: 500, margin: 0 }}>
            Village practitioners willing to refer
          </p>
        </div>

        {/* Card 4: Distress Financing Alert */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Distress Financing Risk</span>
            <AlertTriangle size={20} color="#6366f1" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{kpis?.distressFinancingRate}%</div>
          <p style={{ fontSize: '0.8rem', color: '#4f46e5', marginTop: '0.25rem', margin: 0 }}>
            Families borrowing loans/selling assets
          </p>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Chart 1: Price Elasticity & Projected Monthly Revenue Curve */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Price Elasticity & Optimal Revenue Curve</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
              Identifying package pricing sweet spot for maximum hospital monthly realization
            </p>
          </div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pricingData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="priceTierName" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" orientation="left" stroke="#0ea5e9" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#0f172a' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Area 
                  yAxisId="left" 
                  type="monotone" 
                  dataKey="projectedMonthlyRevenueLakhs" 
                  name="Monthly Revenue (₹ Lakhs)" 
                  stroke="#0ea5e9" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRev)" 
                />
                <Line 
                  yAxisId="right" 
                  type="monotone" 
                  dataKey="conversionRate" 
                  name="Willingness to Pay (%)" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  dot={{ r: 4, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Business Strategy Callout Card */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Activity size={24} color="#2563eb" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>AI-Derived Business Decision Rules</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ padding: '0.75rem', background: '#eff6ff', borderLeft: '4px solid #3b82f6', borderRadius: '0 8px 8px 0' }}>
                <span style={{ fontWeight: 700, color: '#1e3a8a', fontSize: '0.9rem' }}>1. Core Anchor Department:</span>
                <p style={{ fontSize: '0.85rem', color: '#1e40af', margin: '0.25rem 0 0 0' }}>
                  Establish a <strong>Laser Urology & Daycare Stone Center (PCNL/URS)</strong> with fixed all-inclusive package at ₹22,000 to capture regional leakage.
                </p>
              </div>

              <div style={{ padding: '0.75rem', background: '#ecfdf5', borderLeft: '4px solid #10b981', borderRadius: '0 8px 8px 0' }}>
                <span style={{ fontWeight: 700, color: '#064e3b', fontSize: '0.9rem' }}>2. B2B Intake Pipeline:</span>
                <p style={{ fontSize: '0.85rem', color: '#065f46', margin: '0.25rem 0 0 0' }}>
                  Launch the <strong>"RMP Tele-Triage Helpline"</strong> across {selectedBlock || selectedDistrict || 'the region'}. {kpis?.rmpTeleTriageReadiness}% of surveyed village doctors confirmed direct referral intent.
                </p>
              </div>

              <div style={{ padding: '0.75rem', background: '#eef2ff', borderLeft: '4px solid #6366f1', borderRadius: '0 8px 8px 0' }}>
                <span style={{ fontWeight: 700, color: '#312e81', fontSize: '0.9rem' }}>3. Payer Strategy:</span>
                <p style={{ fontSize: '0.85rem', color: '#3730a3', margin: '0.25rem 0 0 0' }}>
                  {kpis?.distressFinancingRate}% distress rate indicates empanelment with <strong>Ayushman Bharat PM-JAY</strong> & <strong>Swasthya Sathi</strong> will ensure instant 80%+ bed occupancy.
                </p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8' }}>
            <span>Survey Sample: {kpis?.totalSurveySample} records</span>
            <span>Location: {selectedDistrict || 'All'} Catchment</span>
          </div>
        </div>
      </div>
    </div>
  );
};
