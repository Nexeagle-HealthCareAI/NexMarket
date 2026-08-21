'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { AdminSurveyDto } from '@/lib/sync/api-client';

interface Props {
  surveys: AdminSurveyDto[];
  orphanAnswerKeys: string[];
}

export function HistoricalAnalyticsDashboard({ surveys, orphanAnswerKeys }: Props) {
  const analytics = useMemo(() => {
    let totalOrphanAnswers = 0;
    const keyFrequencies: Record<string, number> = {};
    const possibleRatings: number[] = [];

    // Common words that might indicate sentiment if a string
    const promoterWords = ['good', 'excellent', 'great', 'satisfied', 'very satisfied'];
    const detractorWords = ['bad', 'poor', 'terrible', 'dissatisfied', 'very dissatisfied'];
    
    let textPromoters = 0;
    let textDetractors = 0;
    let textPassives = 0;
    let totalTextRatings = 0;

    surveys.forEach(survey => {
      try {
        const answers = JSON.parse(survey.answersJson || '{}');

        Object.keys(answers).forEach(k => {
          if (orphanAnswerKeys.includes(k)) {
            totalOrphanAnswers++;
            keyFrequencies[k] = (keyFrequencies[k] || 0) + 1;
            
            const val = answers[k];
            // Check for numerical rating (0-10 or 1-5)
            if (typeof val === 'number' || (!isNaN(Number(val)) && String(val).trim() !== '')) {
              const num = Number(val);
              if (num >= 0 && num <= 10) {
                possibleRatings.push(num);
              }
            } else if (typeof val === 'string') {
              const lower = val.toLowerCase().trim();
              if (promoterWords.some(w => lower.includes(w))) {
                textPromoters++; totalTextRatings++;
              } else if (detractorWords.some(w => lower.includes(w))) {
                textDetractors++; totalTextRatings++;
              } else if (['average', 'fair', 'ok', 'okay'].some(w => lower.includes(w))) {
                textPassives++; totalTextRatings++;
              }
            }
          }
        });
      } catch (_) {}
    });

    const topKeys = Object.entries(keyFrequencies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Calculate Numerical NPS if we found enough numerical ratings (0-10 scale assumed)
    let npsScore: number | null = null;
    let numPromoters = 0;
    let numPassives = 0;
    let numDetractors = 0;

    if (possibleRatings.length > 5) { // Need a minimum sample size
      // Try to determine if it's a 1-5 scale or 0-10 scale
      const maxVal = Math.max(...possibleRatings);
      const is5Point = maxVal <= 5;
      
      possibleRatings.forEach(r => {
        if (is5Point) {
          if (r === 5) numPromoters++;
          else if (r === 4) numPassives++;
          else numDetractors++;
        } else {
          if (r >= 9) numPromoters++;
          else if (r >= 7) numPassives++;
          else numDetractors++;
        }
      });
      
      npsScore = Math.round(((numPromoters - numDetractors) / possibleRatings.length) * 100);
    }

    // Fallback to text sentiment NPS
    if (npsScore === null && totalTextRatings > 5) {
      npsScore = Math.round(((textPromoters - textDetractors) / totalTextRatings) * 100);
      numPromoters = textPromoters;
      numPassives = textPassives;
      numDetractors = textDetractors;
    }

    const totalRatingsForScore = numPromoters + numPassives + numDetractors;

    return {
      totalOrphanAnswers,
      topKeys,
      npsScore,
      npsBreakdown: totalRatingsForScore > 0 ? {
        promoters: Math.round((numPromoters / totalRatingsForScore) * 100),
        passives: Math.round((numPassives / totalRatingsForScore) * 100),
        detractors: Math.round((numDetractors / totalRatingsForScore) * 100),
        total: totalRatingsForScore
      } : null
    };
  }, [surveys, orphanAnswerKeys]);

  if (orphanAnswerKeys.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
        <p style={{ color: '#64748b', margin: 0 }}>No historical (unconfigured) data found.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        
        {/* NPS Score Card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}>Net Analytics Score (NPS)</h3>
          
          {analytics.npsScore !== null ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                <span style={{ fontSize: '3.5rem', fontWeight: 900, color: analytics.npsScore > 0 ? '#10b981' : (analytics.npsScore < 0 ? '#ef4444' : '#f59e0b'), lineHeight: 1, letterSpacing: '-0.02em' }}>
                  {analytics.npsScore > 0 ? '+' : ''}{analytics.npsScore}
                </span>
              </div>
              
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                  <div style={{ width: `${analytics.npsBreakdown?.promoters}%`, background: '#10b981' }} title="Promoters" />
                  <div style={{ width: `${analytics.npsBreakdown?.passives}%`, background: '#fbbf24' }} title="Passives" />
                  <div style={{ width: `${analytics.npsBreakdown?.detractors}%`, background: '#ef4444' }} title="Detractors" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8' }}>
                  <span style={{ color: '#10b981' }}>{analytics.npsBreakdown?.promoters}% Promoters</span>
                  <span style={{ color: '#ef4444' }}>{analytics.npsBreakdown?.detractors}% Detractors</span>
                </div>
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>Based on {analytics.npsBreakdown?.total} legacy ratings</div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', margin: 0 }}>Not enough numerical or text rating data found in historical responses to calculate an NPS score.</p>
            </div>
          )}
        </motion.div>

        {/* Legacy Engagement Stats */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}>Legacy Data Volume</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ width: 48, height: 48, borderRadius: '12px', background: 'rgba(99,102,241,0.1)', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              📦
            </div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{analytics.totalOrphanAnswers.toLocaleString()}</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>Total historical data points</div>
            </div>
          </div>
          
          <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.75rem 0', textTransform: 'uppercase' }}>Most Answered Legacy Questions</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {analytics.topKeys.length > 0 ? analytics.topKeys.map(([key, count]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', fontFamily: 'monospace' }}>{key}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5' }}>{count}</span>
              </div>
            )) : (
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>No frequent questions found.</p>
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
