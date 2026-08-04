import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AdminSurveyDto, SurveyQuestionDto } from '@/lib/sync/api-client';

interface EditSurveyResponseModalProps {
  response: AdminSurveyDto | null;
  questions: SurveyQuestionDto[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, newAnswersJson: string) => Promise<void>;
}

export default function EditSurveyResponseModal({ response, questions, isOpen, onClose, onSave }: EditSurveyResponseModalProps) {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (response && isOpen) {
      try {
        setAnswers(JSON.parse(response.answersJson || '{}'));
        setError('');
      } catch (e) {
        setError('Failed to parse existing answers.');
      }
    }
  }, [response, isOpen]);

  if (!isOpen || !response) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await onSave(response.id, JSON.stringify(answers));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAnswerChange = (questionId: string, value: any) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} style={{ position: 'relative', background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Edit Survey Data
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '0.25rem' }}><strong>Contact:</strong> {response.contactName || 'Unknown'}</div>
          <div style={{ fontSize: '0.9rem', color: '#475569' }}><strong>Agent:</strong> {response.agentName || response.agentId}</div>
        </div>

        {error && <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 500 }}>{error}</div>}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {questions.map((q) => (
            <div key={q.id}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                {q.text} {q.isOptional ? <span style={{ color: '#94a3b8', fontWeight: 400 }}>(Optional)</span> : <span style={{ color: '#ef4444' }}>*</span>}
              </label>

              {q.type === 'text' && (
                <input
                  type="text"
                  value={answers[q.questionId] || ''}
                  onChange={(e) => handleAnswerChange(q.questionId, e.target.value)}
                  required={!q.isOptional}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.95rem' }}
                />
              )}

              {q.type === 'single' && (
                <select
                  value={answers[q.questionId] || ''}
                  onChange={(e) => handleAnswerChange(q.questionId, e.target.value)}
                  required={!q.isOptional}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.95rem', background: 'white' }}
                >
                  <option value="">Select option...</option>
                  {q.optionsJson && JSON.parse(q.optionsJson).map((opt: string) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}

              {q.type === 'multi' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {q.optionsJson && JSON.parse(q.optionsJson).map((opt: string) => {
                    const currentValues: string[] = Array.isArray(answers[q.questionId]) ? answers[q.questionId] : [];
                    const isChecked = currentValues.includes(opt);
                    return (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.95rem', color: '#475569' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              handleAnswerChange(q.questionId, [...currentValues, opt]);
                            } else {
                              handleAnswerChange(q.questionId, currentValues.filter(v => v !== opt));
                            }
                          }}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', background: '#4f46e5', color: 'white', fontWeight: 600, cursor: isSaving ? 'not-allowed' : 'pointer', transition: 'all 0.2s', opacity: isSaving ? 0.7 : 1 }}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
