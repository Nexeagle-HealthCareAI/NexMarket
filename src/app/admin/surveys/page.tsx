'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import { getAdminSurveys, type AdminSurveyDto } from '@/lib/sync/api-client';

export default function AdminSurveysPage() {
  const token = useAgentStore((s) => s.jwtToken);
  const [surveys, setSurveys] = useState<AdminSurveyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Not authenticated');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getAdminSurveys(token)
      .then((data) => {
        if (!cancelled) setSurveys(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch surveys');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '2rem' }}>Survey Analytics</h1>

      {loading && <p>Loading surveys...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && surveys.length === 0 && (
        <p>No survey responses recorded yet.</p>
      )}

      {!loading && !error && surveys.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '1.5rem' }}>
          {surveys.map((survey) => {
            let answers: Record<string, unknown> = {};
            try {
              answers = JSON.parse(survey.answersJson);
            } catch {
              // Malformed/legacy payload — render the card with no answers rather than crash.
            }

            return (
              <motion.div
                key={survey.id}
                whileHover={{ scale: 1.01 }}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  border: '1px solid #e5e7eb'
                }}
              >
                <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Agent ID: {survey.agentId}</p>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Date: {new Date(survey.createdAt).toLocaleString()}</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {Object.entries(answers).map(([qId, ans]) => (
                    <div key={qId}>
                      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4f46e5', textTransform: 'uppercase' }}>{qId}</p>
                      <p style={{ fontSize: '1rem', color: '#1f2937' }}>{String(ans)}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
