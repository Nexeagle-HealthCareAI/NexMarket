'use client';

import React from 'react';
import { type SurveyQuestionDto } from '@/lib/sync/api-client';

interface SurveyQuestionnaireTabProps {
  questionsLoading: boolean;
  questionsError: string | null;
  questions: SurveyQuestionDto[];
  setEditingQuestion: (q: SurveyQuestionDto) => void;
  handleDeleteQuestion: (id: string) => void;
}

export function SurveyQuestionnaireTab({
  questionsLoading, questionsError, questions,
  setEditingQuestion, handleDeleteQuestion
}: SurveyQuestionnaireTabProps) {
  
  if (questionsLoading) return <p>Loading questions...</p>;
  if (questionsError) return <p style={{ color: 'red' }}>{questionsError}</p>;
  if (questions.length === 0) return <p>No questions defined. Add one!</p>;

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden', maxWidth: '100%' }}>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
          <tr>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', width: '60px' }}>Order</th>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', width: '120px' }}>Key (ID)</th>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Question Text</th>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', width: '120px' }}>Type</th>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', width: '100px' }}>Required</th>
            <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', width: '140px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => (
            <tr key={q.id} style={{ borderBottom: '1px solid #e2e8f0', opacity: q.isActive ? 1 : 0.5, transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={{ padding: '1rem', color: '#64748b', fontWeight: 600, textAlign: 'center' }}>{q.order}</td>
              <td style={{ padding: '1rem', color: '#4f46e5', fontWeight: 600 }}>{q.questionId}</td>
              <td style={{ padding: '1rem', color: '#0f172a' }}>
                <div style={{ fontWeight: 600 }}>{q.text}</div>
                {(q.type === 'single' || q.type === 'multi') && q.optionsJson && (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.4rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {JSON.parse(q.optionsJson).map((opt: string) => (
                      <span key={opt} style={{ background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>{opt}</span>
                    ))}
                  </div>
                )}
              </td>
              <td style={{ padding: '1rem', color: '#475569', textTransform: 'capitalize', fontWeight: 500 }}>{q.type}</td>
              <td style={{ padding: '1rem' }}>
                <span style={{ padding: '0.3rem 0.6rem', background: q.isOptional ? '#f1f5f9' : '#fee2e2', color: q.isOptional ? '#64748b' : '#b91c1c', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                  {q.isOptional ? 'Optional' : 'Required'}
                </span>
              </td>
              <td style={{ padding: '1rem', textAlign: 'right' }}>
                <button onClick={() => setEditingQuestion(q)} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', marginRight: '0.5rem', fontSize: '0.8rem', transition: 'all 0.2s' }}>Edit</button>
                <button onClick={() => handleDeleteQuestion(q.id)} style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s' }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}
