'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { db, useActiveVisit } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useAgentStore } from '@/store/agent-store';
import { useTranslations } from '@/i18n/I18nProvider';
import { useLiveQuery } from 'dexie-react-hooks';

type Answer = string | number | string[];

function isOtherOption(opt: unknown): boolean {
  return typeof opt === 'string' && opt.trim().toLowerCase() === 'other';
}

interface SurveyQuestion {
  id: string;
  text: string;
  type: string;
  options?: string[];
  section?: string;
  isOptional?: boolean;
}

export default function SurveyClient({ contactId: initialContactId, onClose }: { contactId?: string, onClose?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeVisit = useActiveVisit(agentId ?? undefined);

  // Load dynamic questions from DB
  const dynamicQuestions = useLiveQuery(() => 
    db.surveyQuestions.where('isActive').equals('true').or('isActive').equals(1).sortBy('order')
      .then(qs => qs.length > 0 ? qs : db.surveyQuestions.orderBy('order').filter(q => q.isActive).toArray())
  );

  const QUESTIONS: SurveyQuestion[] = useMemo(() => {
    return (dynamicQuestions ?? []).map(q => ({
      id: q.questionId,
      text: q.text,
      type: q.type,
      options: q.optionsJson ? (JSON.parse(q.optionsJson) as string[]) : undefined,
      section: q.section,
      isOptional: q.isOptional
    }));
  }, [dynamicQuestions]);

  // Group questions by section
  const sections = useMemo(() => {
    const map = new Map<string, SurveyQuestion[]>();
    QUESTIONS.forEach(q => {
      const sec = q.section || 'General';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(q);
    });
    return Array.from(map.keys());
  }, [QUESTIONS]);

  const [currentTab, setCurrentTab] = useState<number>(0);
  const [responses, setResponses] = useState<Record<string, Answer>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showSkipPrompt, setShowSkipPrompt] = useState(false);
  const [skipReason, setSkipReason] = useState<string>('');
  const [submitError, setSubmitError] = useState('');

  const contactId = initialContactId || searchParams.get('contactId') || undefined;

  useEffect(() => {
    document.body.classList.add('survey-mode');
    return () => {
      document.body.classList.remove('survey-mode');
    };
  }, []);

  const handleInput = (qId: string, val: Answer) => {
    setResponses(prev => ({ ...prev, [qId]: val }));
  };

  const handleNextSection = async () => {
    if (currentTab < sections.length - 1) {
      setCurrentTab(currentTab + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      await submitSurvey(false, '');
    }
  };

  const submitSurvey = async (isSkipped = false, reason = '') => {
    if (!agentId || !deviceId) return;
    setLoading(true);
    setSubmitError('');
    try {
      const clientId = uuidv4();
      const responsesRecord = Object.fromEntries(
        Object.entries(responses).map(([k, v]) => {
          const written = otherText[k]?.trim();
          const withWriteIn = (item: unknown) => (isOtherOption(item) && written ? `Other: ${written}` : item);
          if (Array.isArray(v)) return [k, v.map(withWriteIn).join(', ')];
          return [k, String(withWriteIn(v))];
        })
      );

      const surveyRecord = {
        clientId,
        deviceId,
        agentId,
        contactId,
        panchayatId: activeVisit?.panchayatId,
        isSkipped,
        skipReason: reason || undefined,
        answersJson: JSON.stringify(responsesRecord),
        createdAt: new Date().toISOString(),
      };

      await db.surveyResponses.add(surveyRecord);
      await addToOutbox(clientId, deviceId, 'survey', surveyRecord);
      
      if (onClose) onClose();
      else router.push('/home');
    } catch (e) {
      console.error(e);
      setSubmitError('Could not save this response. Please try again.');
      setLoading(false);
    }
  };

  if (dynamicQuestions === undefined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)' }}>
        <h2 style={{ color: 'white' }}>Loading Questions...</h2>
      </div>
    );
  }

  if (QUESTIONS.length === 0) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)', padding: '2rem', textAlign: 'center' }}>
        <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</span>
        <h2 style={{ color: 'white', marginBottom: '0.5rem' }}>No survey questions configured</h2>
        <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '2rem' }}>Ask your admin to add questions in the Surveys → Questionnaire tab.</p>
        <button
          onClick={() => { if (onClose) onClose(); else router.back(); }}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '20px', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 }}
        >
          {t.surveyCancel}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
          <span style={{ fontSize: '3rem' }}>⏳</span>
        </motion.div>
        <h2 style={{ color: 'white', marginTop: '1rem' }}>{t.savingSurvey}...</h2>
      </div>
    );
  }

  const currentSectionName = sections[currentTab];
  const sectionQuestions = QUESTIONS.filter(q => (q.section || 'General') === currentSectionName);

  // Check if all non-optional questions in current section are answered
  const canProceed = sectionQuestions.every(q => {
    if (q.isOptional) return true;
    const ans = responses[q.id];
    if (q.type === 'multi') {
        const arr = ans as string[];
        if (!arr || arr.length === 0) return false;
        if (arr.some(isOtherOption) && !otherText[q.id]?.trim()) return false;
        return true;
    }
    if (!ans) return false;
    if (isOtherOption(ans) && !otherText[q.id]?.trim()) return false;
    return true;
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', display: 'flex', flexDirection: 'column', zIndex: 100, overflowY: 'auto' }}>
      
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: 'white', position: 'sticky', top: 0, zIndex: 40, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { if (onClose) onClose(); else router.back(); }} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', opacity: 0.8, fontWeight: 600 }}>← Cancel</button>
          <span style={{ fontWeight: 700 }}>Survey</span>
          <button onClick={() => setShowSkipPrompt(true)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '15px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>Skip</button>
        </div>
        
        {/* Tab Bar */}
        <div style={{ display: 'flex', overflowX: 'auto', padding: '0 0.5rem', scrollbarWidth: 'none' }}>
          {sections.map((sec, idx) => (
            <button
              key={sec}
              onClick={() => setCurrentTab(idx)}
              style={{
                background: 'transparent',
                border: 'none',
                color: currentTab === idx ? '#fbbf24' : 'rgba(255,255,255,0.6)',
                borderBottom: currentTab === idx ? '3px solid #fbbf24' : '3px solid transparent',
                padding: '0.75rem 1rem',
                fontSize: '0.9rem',
                fontWeight: currentTab === idx ? 800 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {sec.split(':')[0]} {/* E.g. "Section A" */}
            </button>
          ))}
        </div>
      </div>

      {submitError && (
        <div style={{ margin: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>
          ⚠️ {submitError}
        </div>
      )}

      {/* Main Form Content */}
      <div style={{ flex: 1, padding: '1.5rem 1rem 6rem 1rem', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}
          >
            <div style={{ marginBottom: '-1rem' }}>
                <h2 style={{ color: '#1e293b', fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>{currentSectionName}</h2>
                <div style={{ height: 3, width: 40, background: '#4f46e5', marginTop: '0.5rem', borderRadius: 2 }} />
            </div>

            {sectionQuestions.map((q, qIndex) => (
                <div key={q.id} style={{ background: 'white', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 15px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#334155', marginBottom: '1rem', lineHeight: 1.4 }}>
                        <span style={{ color: '#4f46e5', marginRight: '0.5rem' }}>Q{qIndex + 1}.</span> 
                        {q.text}
                        {q.isOptional && <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '0.5rem', fontWeight: 500 }}>(Optional)</span>}
                    </h3>

                    {q.type === 'single' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {q.options!.map((opt) => {
                          const isOther = isOtherOption(opt);
                          const selected = responses[q.id] === opt;
                          return (
                              <React.Fragment key={opt}>
                                <div 
                                    onClick={() => handleInput(q.id, opt)}
                                    style={{
                                        background: selected ? '#eef2ff' : '#f8fafc',
                                        border: selected ? '2px solid #6366f1' : '1px solid #e2e8f0',
                                        padding: '1rem',
                                        borderRadius: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: selected ? '6px solid #4f46e5' : '2px solid #cbd5e1', background: 'white', flexShrink: 0 }} />
                                    <span style={{ color: selected ? '#312e81' : '#475569', fontWeight: selected ? 700 : 500, fontSize: '0.9rem' }}>{opt}</span>
                                </div>
                                {isOther && selected && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ paddingLeft: '2.5rem' }}>
                                        <input 
                                            autoFocus
                                            type="text"
                                            value={otherText[q.id] || ''}
                                            onChange={(e) => setOtherText({ ...otherText, [q.id]: e.target.value })}
                                            placeholder="Please specify..."
                                            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem', outlineColor: '#4f46e5' }}
                                        />
                                    </motion.div>
                                )}
                              </React.Fragment>
                          );
                        })}
                      </div>
                    ) : q.type === 'multi' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '-0.75rem', marginBottom: '0.25rem' }}>Select all that apply</p>
                        {q.options!.map((opt) => {
                          const isOther = isOtherOption(opt);
                          const currentArr = Array.isArray(responses[q.id]) ? (responses[q.id] as string[]) : [];
                          const selected = currentArr.includes(opt);
                          return (
                              <React.Fragment key={opt}>
                                <div 
                                    onClick={() => {
                                        if (selected) {
                                            handleInput(q.id, currentArr.filter(o => o !== opt));
                                        } else {
                                            handleInput(q.id, [...currentArr, opt]);
                                        }
                                    }}
                                    style={{
                                        background: selected ? '#eef2ff' : '#f8fafc',
                                        border: selected ? '2px solid #6366f1' : '1px solid #e2e8f0',
                                        padding: '1rem',
                                        borderRadius: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <div style={{ width: 22, height: 22, borderRadius: '6px', border: selected ? 'none' : '2px solid #cbd5e1', background: selected ? '#4f46e5' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {selected && <span style={{ color: 'white', fontSize: '0.9rem', fontWeight: 800 }}>✓</span>}
                                    </div>
                                    <span style={{ color: selected ? '#312e81' : '#475569', fontWeight: selected ? 700 : 500, fontSize: '0.9rem' }}>{opt}</span>
                                </div>
                                {isOther && selected && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ paddingLeft: '2.5rem' }}>
                                        <input 
                                            autoFocus
                                            type="text"
                                            value={otherText[q.id] || ''}
                                            onChange={(e) => setOtherText({ ...otherText, [q.id]: e.target.value })}
                                            placeholder="Please specify..."
                                            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem', outlineColor: '#4f46e5' }}
                                        />
                                    </motion.div>
                                )}
                              </React.Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {q.type === 'number' ? (
                          <input 
                            type="number"
                            value={responses[q.id] as number || ''}
                            onChange={(e) => handleInput(q.id, Number(e.target.value))}
                            placeholder={t.typeNumber || "Type a number..."}
                            style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1.2rem', outlineColor: '#4f46e5', background: '#f8fafc' }}
                          />
                        ) : (
                          <textarea 
                            value={responses[q.id] as string || ''}
                            onChange={(e) => handleInput(q.id, e.target.value)}
                            placeholder={t.typeAnswer || "Type your answer..."}
                            rows={3}
                            style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', outlineColor: '#4f46e5', background: '#f8fafc', resize: 'vertical' }}
                          />
                        )}
                      </div>
                    )}
                </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Sticky Action Bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '1rem 1.5rem', boxShadow: '0 -4px 15px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'flex-end', zIndex: 40 }}>
        <button
          onClick={handleNextSection}
          disabled={!canProceed}
          style={{
            background: canProceed ? '#4f46e5' : '#e2e8f0',
            color: canProceed ? 'white' : '#94a3b8',
            border: 'none',
            padding: '1rem 2rem',
            borderRadius: '12px',
            fontSize: '1.1rem',
            fontWeight: 700,
            cursor: canProceed ? 'pointer' : 'not-allowed',
            width: '100%',
            maxWidth: 400,
            transition: 'all 0.2s ease',
            boxShadow: canProceed ? '0 4px 15px rgba(79,70,229,0.3)' : 'none'
          }}
        >
          {currentTab < sections.length - 1 ? 'Next Section →' : 'Submit Survey'}
        </button>
      </div>

      {/* Skip Prompt Overlay */}
      <AnimatePresence>
        {showSkipPrompt && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', zIndex: 50 }}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              style={{ background: 'white', color: '#0f172a', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '400px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}
            >
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800 }}>{t.reasonForSkip || 'Why are you skipping?'}</h3>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.9rem' }}>{t.surveyOptional || 'The health survey is optional.'}</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {[
                  { value: 'not_interested', label: t.skipReasonNotInterested || 'Not interested / Refused' },
                  { value: 'no_time', label: t.skipReasonNoTime || 'No time / Too busy' },
                  { value: 'not_applicable', label: t.skipReasonNotApplicable || 'Not applicable' },
                  { value: 'other', label: t.skipReasonOther || 'Other' }
                ].map(reason => (
                  <label key={reason.value} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', background: skipReason === reason.value ? '#eff6ff' : 'white', borderColor: skipReason === reason.value ? '#3b82f6' : '#e2e8f0' }}>
                    <input type="radio" name="skipReason" value={reason.value} checked={skipReason === reason.value} onChange={() => setSkipReason(reason.value)} style={{ width: '1rem', height: '1rem' }} />
                    <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{reason.label}</span>
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={() => setShowSkipPrompt(false)} style={{ flex: 1, padding: '0.85rem', background: '#f1f5f9', border: 'none', borderRadius: '8px', color: '#475569', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => submitSurvey(true, skipReason)} disabled={!skipReason} style={{ flex: 1, padding: '0.85rem', background: skipReason ? '#ef4444' : '#fca5a5', border: 'none', borderRadius: '8px', color: 'white', fontWeight: 700, cursor: skipReason ? 'pointer' : 'not-allowed' }}>{t.confirmSkip || 'Confirm Skip'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
