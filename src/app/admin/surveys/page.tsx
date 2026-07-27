'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export default function AdminSurveysPage() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSurveys() {
      try {
        const token = localStorage.getItem('admin_token'); // from dummy auth or real auth
        if (!token) {
          throw new Error('Not authenticated');
        }
        
        const res = await fetch('http://localhost:5000/api/v1/admin/surveys', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!res.ok) throw new Error('Failed to fetch surveys');
        
        const data = await res.json();
        setSurveys(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchSurveys();
  }, []);

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
            let answers = {};
            try {
              answers = JSON.parse(survey.answersJson);
            } catch(e) {}
            
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
