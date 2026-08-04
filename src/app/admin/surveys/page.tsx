'use client';

import React, { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getAdminSurveys, type AdminSurveyDto, getAdminSurveyQuestions, createAdminSurveyQuestion, updateAdminSurveyQuestion, deleteAdminSurveyQuestion, type SurveyQuestionDto, getPanchayats, type PanchayatDto } from '@/lib/sync/api-client';
import { motion, AnimatePresence } from 'framer-motion';

export default function AdminSurveysPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const [activeTab, setActiveTab] = useState<'responses' | 'questionnaire'>('responses');

  // Responses State
  const [surveys, setSurveys] = useState<AdminSurveyDto[]>([]);
  const [allPanchayats, setAllPanchayats] = useState<PanchayatDto[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [surveysError, setSurveysError] = useState<string | null>(null);

  // Filter States
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

  // Questionnaire State
  const [questions, setQuestions] = useState<SurveyQuestionDto[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  
  // Editor State
  const [editingQuestion, setEditingQuestion] = useState<Partial<SurveyQuestionDto> | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    setSurveysLoading(true);
    setQuestionsLoading(true);

    Promise.all([
      getAdminSurveys().catch(e => { if (!cancelled) setSurveysError(e.message); return []; }),
      getAdminSurveyQuestions().catch(e => { if (!cancelled) setQuestionsError(e.message); return []; }),
      getPanchayats().catch(() => [])
    ]).then(([sData, qData, pData]) => {
      if (!cancelled) {
        if (sData) setSurveys(sData as AdminSurveyDto[]);
        if (qData) setQuestions(qData as SurveyQuestionDto[]);
        if (pData) setAllPanchayats(pData as PanchayatDto[]);
        setSurveysLoading(false);
        setQuestionsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [agentId]);

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

  // Column list for the Responses table = every configured question, PLUS any
  // answer key that shows up in actual response data but has no matching
  // SurveyQuestionDto (e.g. responses submitted while the questionnaire had
  // zero questions configured — the agent app falls back to a hardcoded
  // legacy q1..q6 set in that case). Without this, those answers exist in the
  // data but never get a column to render under, and the table looks like it
  // only has Person Name / Added By / Date Added.
  const knownQuestionIds = new Set(questions.map(q => q.questionId));
  const orphanAnswerKeys = new Set<string>();
  surveys.forEach((s) => {
    try {
      Object.keys(JSON.parse(s.answersJson)).forEach((k) => {
        if (!knownQuestionIds.has(k)) orphanAnswerKeys.add(k);
      });
    } catch {}
  });
  const responseColumns: { questionId: string; text: string }[] = [
    ...questions.map((q) => ({ questionId: q.questionId, text: q.text })),
    ...[...orphanAnswerKeys].sort().map((k) => ({ questionId: k, text: `(unconfigured: ${k})` })),
  ];

  // Compute unique regions for filters
  const uniqueDistricts = Array.from(new Set(allPanchayats.map(p => p.district))).sort();
  
  const filteredBlocks = allPanchayats
    .filter(p => selectedDistricts.length === 0 || selectedDistricts.includes(p.district))
    .map(p => p.block);
  const uniqueBlocks = Array.from(new Set(filteredBlocks)).sort();

  const filteredPanchayatList = allPanchayats
    .filter(p => (selectedDistricts.length === 0 || selectedDistricts.includes(p.district)) &&
                 (selectedBlocks.length === 0 || selectedBlocks.includes(p.block)));
  const uniquePanchayats = Array.from(new Set(filteredPanchayatList.map(p => p.id))).sort();

  // Apply filters
  const filteredSurveys = surveys.filter(survey => {
    const panchayat = allPanchayats.find(p => p.id === survey.panchayatId);
    if (!panchayat) return true; // Show items with unknown panchayat
    
    if (selectedDistricts.length > 0 && !selectedDistricts.includes(panchayat.district)) return false;
    if (selectedBlocks.length > 0 && !selectedBlocks.includes(panchayat.block)) return false;
    if (selectedPanchayats.length > 0 && !selectedPanchayats.includes(panchayat.id)) return false;
    
    return true;
  });

  return (
    <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
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

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: '2px' }}>
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
          <div style={{ flex: 1, overflowY: 'auto', width: '100%', minWidth: 0 }}>
            {questionsError && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>⚠️ Question columns may be incomplete — failed to load the questionnaire: {questionsError}</p>}
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'white', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Filter By Location:</span>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <MultiSelectDropdown
                  label="District"
                  options={uniqueDistricts.map(d => ({ value: d, label: d }))}
                  selected={selectedDistricts}
                  onChange={(val) => { setSelectedDistricts(val); setSelectedBlocks([]); setSelectedPanchayats([]); }}
                  placeholder="All Districts"
                />
              </div>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <MultiSelectDropdown
                  label="Block"
                  options={uniqueBlocks.map(b => ({ value: b, label: b }))}
                  selected={selectedBlocks}
                  onChange={(val) => { setSelectedBlocks(val); setSelectedPanchayats([]); }}
                  disabled={selectedDistricts.length === 0 && uniqueBlocks.length === 0}
                  placeholder="All Blocks"
                />
              </div>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <MultiSelectDropdown
                  label="Panchayat"
                  options={uniquePanchayats.map(pId => {
                    const p = allPanchayats.find(x => x.id === pId);
                    return { value: pId, label: p ? `${p.name} (${p.district})` : pId };
                  })}
                  selected={selectedPanchayats}
                  onChange={(val) => setSelectedPanchayats(val)}
                  disabled={selectedBlocks.length === 0 && uniquePanchayats.length === 0}
                  placeholder="All Panchayats"
                />
              </div>
            </div>

            {surveysLoading && <p>Loading responses...</p>}
            {surveysError && <p style={{ color: 'red' }}>{surveysError}</p>}
            {!surveysLoading && !surveysError && filteredSurveys.length === 0 && <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No responses match the selected filters.</p>}
            {!surveysLoading && filteredSurveys.length > 0 && (

                <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden', maxWidth: '100%' }}>
                  <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', minWidth: '160px' }}>Person Name</th>
                        <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', minWidth: '140px' }}>Added By</th>
                        {responseColumns.map((q, i) => (
                          <th key={q.questionId} title={q.text} style={{ padding: '1rem', fontWeight: 700, color: '#4f46e5', minWidth: '200px' }}>
                            Question {i + 1}
                            <div style={{ fontWeight: 500, color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>{q.text}</div>
                          </th>
                        ))}
                        <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', minWidth: '120px' }}>Date Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSurveys.map((survey) => {
                        let answers: Record<string, unknown> = {};
                        try { answers = JSON.parse(survey.answersJson); } catch {}

                        return (
                          <tr key={survey.id} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <td style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{survey.contactName || 'Unknown'}</td>
                            <td style={{ padding: '1rem', color: '#334155' }}>{survey.agentName || survey.agentId}</td>
                            {responseColumns.map((q) => {
                              const ans = answers[q.questionId];
                              const hasAnswer = ans !== undefined && ans !== null && ans !== '';
                              return (
                                <td key={q.questionId} style={{ padding: '1rem', color: '#334155' }}>
                                  {hasAnswer ? (
                                    <span style={{ background: '#f1f5f9', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500, display: 'inline-block' }}>
                                      {String(ans)}
                                    </span>
                                  ) : (
                                    <span style={{ color: '#cbd5e1', fontSize: '0.85rem', fontStyle: 'italic' }}>No answer</span>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{ padding: '1rem', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(survey.createdAt).toLocaleDateString('en-GB')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'questionnaire' && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, width: '100%' }}>
            {questionsLoading && <p>Loading questions...</p>}
            {questionsError && <p style={{ color: 'red' }}>{questionsError}</p>}
            {!questionsLoading && !questionsError && questions.length === 0 && <p>No questions defined. Add one!</p>}
            {!questionsLoading && questions.length > 0 && (
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
                      <option value="single">Single Choice (one answer)</option>
                      <option value="multi">Multiple Choice (many answers)</option>
                      <option value="text">Free Text Input</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Order</label>
                    <input type="number" required value={editingQuestion.order || 0} onChange={e => setEditingQuestion({...editingQuestion, order: parseInt(e.target.value) || 0})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                  </div>
                </div>

                {(editingQuestion.type === 'single' || editingQuestion.type === 'multi') && (
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

// MultiSelect Dropdown Component
interface MultiSelectDropdownProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

function MultiSelectDropdown({ label, options, selected, onChange, disabled, placeholder }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleSelection = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((o: string) => o !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div style={{ position: 'relative', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>{label}</label>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', 
          padding: '0.5rem 1rem', width: '220px', cursor: 'pointer', 
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.85rem', color: selected.length === 0 ? '#64748b' : '#0f172a' }}>
            {selected.length === 0 ? (placeholder || 'Select...') : `${selected.length} Selected`}
          </span>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            style={{ 
              position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', width: '250px', 
              background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', 
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 50,
              maxHeight: '300px', overflowY: 'auto'
            }}
          >
            <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setIsOpen(false)} />
            
            <div style={{ padding: '0.5rem' }}>
              {options.length === 0 ? (
                <div style={{ padding: '0.5rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>No options available</div>
              ) : (
                options.map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer', borderRadius: '4px', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <input 
                      type="checkbox" 
                      checked={selected.includes(opt.value)}
                      onChange={() => toggleSelection(opt.value)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: selected.includes(opt.value) ? 600 : 400 }}>{opt.label}</span>
                  </label>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
