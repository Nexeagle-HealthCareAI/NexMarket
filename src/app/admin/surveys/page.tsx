'use client';

import React, { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getAdminSurveys, type AdminSurveyDto, getAdminSurveyQuestions, createAdminSurveyQuestion, updateAdminSurveyQuestion, deleteAdminSurveyQuestion, type SurveyQuestionDto } from '@/lib/sync/api-client';
import { motion, AnimatePresence } from 'framer-motion';

export default function AdminSurveysPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const [activeTab, setActiveTab] = useState<'responses' | 'questionnaire'>('responses');

  // Responses State
  const [surveys, setSurveys] = useState<AdminSurveyDto[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [surveysError, setSurveysError] = useState<string | null>(null);

  // Questionnaire State
  const [questions, setQuestions] = useState<SurveyQuestionDto[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  
  // Editor State
  const [editingQuestion, setEditingQuestion] = useState<Partial<SurveyQuestionDto> | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    if (activeTab === 'responses') {
      setSurveysLoading(true);
      getAdminSurveys()
        .then(data => { if (!cancelled) setSurveys(data); })
        .catch(e => { if (!cancelled) setSurveysError(e.message); })
        .finally(() => { if (!cancelled) setSurveysLoading(false); });
    } else {
      setQuestionsLoading(true);
      getAdminSurveyQuestions()
        .then(data => { if (!cancelled) setQuestions(data); })
        .catch(e => { if (!cancelled) setQuestionsError(e.message); })
        .finally(() => { if (!cancelled) setQuestionsLoading(false); });
    }

    return () => { cancelled = true; };
  }, [agentId, activeTab]);

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;
    
    const payload = {
      questionId: editingQuestion.questionId || '',
      text: editingQuestion.text || '',
      type: editingQuestion.type || 'single',
      optionsJson: editingQuestion.optionsJson || null,
      isOptional: editingQuestion.isOptional || false,
      isActive: editingQuestion.isActive ?? true,
      order: editingQuestion.order || 0
    };

    try {
      if (editingQuestion.id) {
        await updateAdminSurveyQuestion(editingQuestion.id, payload);
      } else {
        await createAdminSurveyQuestion(payload);
      }
      setEditingQuestion(null);
      
      // Refresh list
      const data = await getAdminSurveyQuestions();
      setQuestions(data);
    } catch (e: any) {
      alert(e.message || 'Failed to save question');
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await deleteAdminSurveyQuestion(id);
      setQuestions(q => q.filter(x => x.id !== id));
    } catch (e: any) {
      alert(e.message || 'Failed to delete question');
    }
  };

  if (!agentId) return <div style={{ padding: '2rem' }}>Not authenticated</div>;

  return (
    <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem', color: '#0f172a' }}>Surveys</h1>
          <p style={{ color: '#64748b' }}>Manage survey responses and the dynamic questionnaire</p>
        </div>
        {activeTab === 'questionnaire' && (
          <button 
            onClick={() => setEditingQuestion({ type: 'single', isOptional: false, isActive: true, order: questions.length + 1 })}
            style={{ background: '#4f46e5', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            + Add Question
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setActiveTab('responses')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'responses' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'responses' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          📊 Responses
        </button>
        <button
          onClick={() => setActiveTab('questionnaire')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'questionnaire' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'questionnaire' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          📋 Questionnaire
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'responses' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {surveysLoading && <p>Loading responses...</p>}
            {surveysError && <p style={{ color: 'red' }}>{surveysError}</p>}
            {!surveysLoading && !surveysError && surveys.length === 0 && <p>No responses yet.</p>}
            {!surveysLoading && surveys.length > 0 && (
              <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155' }}>S.No</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155' }}>Added By</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155' }}>Contact ID</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155' }}>Answers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {surveys.map((survey, index) => {
                      let answers: Record<string, unknown> = {};
                      try { answers = JSON.parse(survey.answersJson); } catch {}
                      return (
                        <tr key={survey.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '1rem', color: '#475569' }}>{index + 1}</td>
                          <td style={{ padding: '1rem', color: '#475569' }}>{survey.agentId}</td>
                          <td style={{ padding: '1rem', color: '#475569' }}>{survey.contactId || 'Unknown'}</td>
                          <td style={{ padding: '1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {Object.entries(answers).map(([qId, ans]) => (
                                <div key={qId} style={{ fontSize: '0.85rem' }}>
                                  <span style={{ fontWeight: 600, color: '#4f46e5', marginRight: '0.5rem' }}>{qId}:</span>
                                  <span style={{ color: '#1e293b' }}>{String(ans)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'questionnaire' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {questionsLoading && <p>Loading questions...</p>}
            {questionsError && <p style={{ color: 'red' }}>{questionsError}</p>}
            {!questionsLoading && !questionsError && questions.length === 0 && <p>No questions defined. Add one!</p>}
            {!questionsLoading && questions.length > 0 && (
              <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155', width: '60px' }}>Order</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155', width: '120px' }}>Key (ID)</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155' }}>Question Text</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155', width: '120px' }}>Type</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155', width: '100px' }}>Required</th>
                      <th style={{ padding: '1rem', fontWeight: 600, color: '#334155', width: '140px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q) => (
                      <tr key={q.id} style={{ borderBottom: '1px solid #e2e8f0', opacity: q.isActive ? 1 : 0.5 }}>
                        <td style={{ padding: '1rem', color: '#475569', fontWeight: 600 }}>{q.order}</td>
                        <td style={{ padding: '1rem', color: '#4f46e5', fontWeight: 600 }}>{q.questionId}</td>
                        <td style={{ padding: '1rem', color: '#0f172a' }}>
                          <div>{q.text}</div>
                          {q.type === 'single' && q.optionsJson && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                              Options: {JSON.parse(q.optionsJson).join(', ')}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '1rem', color: '#475569', textTransform: 'capitalize' }}>{q.type}</td>
                        <td style={{ padding: '1rem' }}>
                          <span style={{ padding: '0.2rem 0.5rem', background: q.isOptional ? '#f1f5f9' : '#fee2e2', color: q.isOptional ? '#64748b' : '#b91c1c', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                            {q.isOptional ? 'Optional' : 'Required'}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                          <button onClick={() => setEditingQuestion(q)} style={{ background: 'transparent', border: 'none', color: '#4f46e5', fontWeight: 600, cursor: 'pointer', marginRight: '1rem' }}>Edit</button>
                          <button onClick={() => handleDeleteQuestion(q.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingQuestion && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingQuestion(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }} />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} style={{ position: 'relative', background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem', color: '#0f172a' }}>
                {editingQuestion.id ? 'Edit Question' : 'Add Question'}
              </h2>
              <form onSubmit={handleSaveQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Question Key (ID)</label>
                  <input required value={editingQuestion.questionId || ''} onChange={e => setEditingQuestion({...editingQuestion, questionId: e.target.value})} placeholder="e.g. q1, current_party" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                  <small style={{ color: '#64748b' }}>A unique identifier used for saving responses.</small>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Question Text</label>
                  <input required value={editingQuestion.text || ''} onChange={e => setEditingQuestion({...editingQuestion, text: e.target.value})} placeholder="What is your favorite color?" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Type</label>
                    <select value={editingQuestion.type || 'single'} onChange={e => setEditingQuestion({...editingQuestion, type: e.target.value as any})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}>
                      <option value="single">Single Choice (Options)</option>
                      <option value="text">Free Text Input</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Order</label>
                    <input type="number" required value={editingQuestion.order || 0} onChange={e => setEditingQuestion({...editingQuestion, order: parseInt(e.target.value) || 0})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                  </div>
                </div>

                {editingQuestion.type === 'single' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Options (JSON Array)</label>
                    <textarea 
                      required 
                      value={editingQuestion.optionsJson || ''} 
                      onChange={e => setEditingQuestion({...editingQuestion, optionsJson: e.target.value})} 
                      placeholder='["Red", "Blue", "Green"]' 
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', minHeight: '80px', fontFamily: 'monospace' }} 
                    />
                    <small style={{ color: '#64748b' }}>Must be a valid JSON array of strings.</small>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editingQuestion.isOptional || false} onChange={e => setEditingQuestion({...editingQuestion, isOptional: e.target.checked})} />
                    Is Optional?
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editingQuestion.isActive ?? true} onChange={e => setEditingQuestion({...editingQuestion, isActive: e.target.checked})} />
                    Is Active?
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditingQuestion(null)} style={{ background: 'transparent', color: '#64748b', fontWeight: 700, border: 'none', cursor: 'pointer', padding: '0.75rem 1.5rem' }}>
                    Cancel
                  </button>
                  <button type="submit" style={{ background: '#4f46e5', color: 'white', fontWeight: 700, border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '0.75rem 1.5rem' }}>
                    Save Question
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
