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
  // NOTE: We use .toArray() + JS filter instead of .where('isActive').equals(true)
  // because Dexie's boolean index is unreliable — booleans can be stored as
  // true/1/'true' depending on the JSON serialiser/browser, so a .equals() 
  // check against a boolean frequently returns 0 results even when data is present.
  const dynamicQuestions = useLiveQuery(() =>
    db.surveyQuestions.orderBy('order').filter(q => Boolean(q.isActive)).toArray()
  );

  const QUESTIONS: SurveyQuestion[] = useMemo(() => {
    return (dynamicQuestions ?? [])
      .filter(q => q.section && q.section.trim() !== '' && q.section !== 'General')
      .map(q => ({
      id: q.questionId ?? q.id, // fallback to id if questionId is missing
      text: q.text,
      type: q.type,
      options: (() => {
        if (!q.optionsJson) return undefined;
        try { return JSON.parse(q.optionsJson) as string[]; } catch { return undefined; }
      })(),
      section: q.section,
      isOptional: q.isOptional
    }));
  }, [dynamicQuestions]);

  // Group questions by section
  const sections = useMemo(() => {
    const map = new Map<string, SurveyQuestion[]>();
    QUESTIONS.forEach(q => {
      const sec = q.section!; // We've filtered out missing sections above
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(q);
    });
    return Array.from(map.keys());
  }, [QUESTIONS]);

  const [currentTab, setCurrentTab] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [responses, setResponses] = useState<Record<string, Answer>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showSkipPrompt, setShowSkipPrompt] = useState(false);
  const [skipReason, setSkipReason] = useState<string>('');
  const [submitError, setSubmitError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const contactId = initialContactId || searchParams.get('contactId') || undefined;

  // Draft key scoped per contact (or 'standalone' for non-contact surveys)
  const SURVEY_DRAFT_KEY = `surveyDraft_${contactId ?? 'standalone'}`;

  const [draftRestored, setDraftRestored] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(true);

  // Load draft on mount
  useEffect(() => {
    let active = true;
    db.drafts.get(SURVEY_DRAFT_KEY).then((draft) => {
      if (!active) return;
      if (draft?.data?.responses && Object.keys(draft.data.responses).length > 0) {
        setResponses(draft.data.responses as Record<string, Answer>);
        setOtherText((draft.data.otherText as Record<string, string>) ?? {});
        if (typeof draft.data.currentTab === 'number') setCurrentTab(draft.data.currentTab);
        setDraftRestored(true);
      }
    }).catch(console.error).finally(() => { if (active) setIsLoadingDraft(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SURVEY_DRAFT_KEY]);

  // Auto-save draft every 500ms when responses change
  useEffect(() => {
    if (isLoadingDraft) return;
    const timer = setTimeout(() => {
      if (Object.keys(responses).length > 0) {
        db.drafts.put({
          id: SURVEY_DRAFT_KEY,
          data: { responses, otherText, currentTab },
          updatedAt: new Date().toISOString(),
        }).catch(console.error);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [responses, otherText, currentTab, isLoadingDraft, SURVEY_DRAFT_KEY]);

  async function clearDraft() {
    await db.drafts.delete(SURVEY_DRAFT_KEY).catch(console.error);
  }
  // Survey mode body class
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

      const surveyRecord: any = {
        clientId,
        deviceId,
        agentId,
        isSkipped,
        answersJson: JSON.stringify(responsesRecord),
        createdAt: new Date().toISOString(),
      };

      if (contactId) surveyRecord.contactId = contactId;
      if (activeVisit?.panchayatId) surveyRecord.panchayatId = activeVisit.panchayatId;
      if (reason) surveyRecord.skipReason = reason;

      await db.surveyResponses.add(surveyRecord);
      await addToOutbox(clientId, deviceId, 'survey', surveyRecord);
      await clearDraft(); // remove saved draft on successful submit
      setShowSuccess(true);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setSubmitError('Could not save this response. Please try again.');
      setLoading(false);
    }
  };

  if (showSuccess) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', zIndex: 100 }}>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.5 }}
          style={{ width: 80, height: 80, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', boxShadow: '0 10px 25px rgba(16,185,129,0.4)' }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </motion.div>
        
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem', textAlign: 'center' }}>Great job!</h2>
        <p style={{ color: '#64748b', fontSize: '1rem', textAlign: 'center', marginBottom: '2.5rem', maxWidth: 300, lineHeight: 1.5 }}>
          Contact and survey details have been securely saved.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: 320 }}>
          <button
            onClick={() => {
              setShowSuccess(false);
              // Instead of router.push which is slow, we use window.location.href or just router.replace to force remount
              window.location.href = '/contacts/new';
            }}
            style={{ padding: '1.1rem', borderRadius: '12px', background: '#4f46e5', color: 'white', fontWeight: 700, fontSize: '1.1rem', border: 'none', cursor: 'pointer', boxShadow: '0 4px 15px rgba(79,70,229,0.3)' }}
          >
            ➕ Add Another Contact
          </button>
          
          <button
            onClick={() => { if (onClose) onClose(); else router.push('/contacts'); }}
            style={{ padding: '1.1rem', borderRadius: '12px', background: 'white', color: '#475569', fontWeight: 700, fontSize: '1.1rem', border: '1px solid #cbd5e1', cursor: 'pointer' }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (dynamicQuestions === undefined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)' }}>
        <h2 style={{ color: 'white' }}>Loading Questions...</h2>
      </div>
    );
  }

  if (QUESTIONS.length === 0 && dynamicQuestions !== undefined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)', padding: '2rem', textAlign: 'center' }}>
        <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</span>
        <h2 style={{ color: 'white', marginBottom: '0.5rem' }}>Survey not yet synced</h2>
        <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '2rem', maxWidth: 280 }}>
          Questions haven't synced to this device yet. Make sure you have internet access, then tap <strong>Retry</strong>.
        </p>
        <button
          onClick={() => { import('@/lib/sync/seeder').then(m => m.refreshReferenceData()); }}
          style={{ background: '#4f46e5', border: 'none', color: 'white', padding: '0.85rem 2rem', borderRadius: '20px', fontSize: '1rem', cursor: 'pointer', fontWeight: 700, marginBottom: '1rem' }}
        >
          🔄 Retry Sync
        </button>
        <button
          onClick={() => { if (onClose) onClose(); else router.back(); }}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'rgba(255,255,255,0.8)', padding: '0.75rem 2rem', borderRadius: '20px', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 }}
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

  const isSearching = searchQuery.trim().length > 0;
  const currentSectionName = sections[currentTab];
  const sectionQuestions = QUESTIONS.filter(q => (q.section || 'General') === currentSectionName);

  const displayedQuestions = isSearching
    ? QUESTIONS.filter(q => q.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : sectionQuestions;

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
    <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', display: 'flex', flexDirection: 'column', zIndex: 100 }}>
      
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: 'white', position: 'sticky', top: 0, zIndex: 40, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { if (onClose) onClose(); else router.back(); }} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', opacity: 0.8, fontWeight: 600 }}>← Cancel</button>
          <span style={{ fontWeight: 700 }}>Survey</span>
          <button onClick={() => setShowSkipPrompt(true)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '15px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>Skip</button>
        </div>
        
        <div style={{ padding: '0 1rem 0.5rem 1rem' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              placeholder="Search questions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.2rem', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: '0.9rem', outline: 'none' }}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.8 }}
              >✕</button>
            )}
          </div>
        </div>
        
        {/* Tab Bar */}
        {!isSearching && (
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
        )}
      </div>

      {submitError && (
        <div style={{ margin: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>
          ⚠️ {submitError}
        </div>
      )}

      {/* Draft Restored Banner */}
      {draftRestored && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ margin: '0.75rem 1rem 0', padding: '0.7rem 1rem', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '1.5px solid #f59e0b', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>📝 Draft restored — answers from your last session.</span>
          <button
            onClick={async () => { await clearDraft(); setResponses({}); setOtherText({}); setCurrentTab(0); setDraftRestored(false); }}
            style={{ background: 'rgba(0,0,0,0.1)', border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, color: '#78350f', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Start Fresh
          </button>
        </motion.div>
      )}

      {/* Main Form Content */}
      <div style={{ flex: 1, padding: '1.5rem 1rem 6rem 1rem', maxWidth: 800, margin: '0 auto', width: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                <h2 style={{ color: '#1e293b', fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>
                  {isSearching ? 'Search Results' : currentSectionName}
                </h2>
                <div style={{ height: 3, width: 40, background: '#4f46e5', marginTop: '0.5rem', borderRadius: 2 }} />
            </div>

            {displayedQuestions.length === 0 && isSearching ? (
              <p style={{ color: '#64748b', textAlign: 'center', marginTop: '2rem' }}>No questions found for &quot;{searchQuery}&quot;.</p>
            ) : (
              displayedQuestions.map((q, qIndex) => (
                <div key={q.id} style={{ background: 'white', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 15px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#334155', marginBottom: '1rem', lineHeight: 1.4 }}>
                        <span style={{ color: '#4f46e5', marginRight: '0.5rem' }}>{isSearching ? '' : `Q${qIndex + 1}.`}</span> 
                        {q.text}
                        {q.isOptional && <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '0.5rem', fontWeight: 500 }}>(Optional)</span>}
                    </h3>

                    {q.type === 'single' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {q.options && q.options.length > 0 ? q.options.map((opt) => {
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
                        }) : <p style={{ color: 'red', fontSize: '0.9rem' }}>No options configured for this question.</p>}
                      </div>
                    ) : q.type === 'multi' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '-0.75rem', marginBottom: '0.25rem' }}>Select all that apply</p>
                        {q.options && q.options.length > 0 ? q.options.map((opt) => {
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
                        }) : <p style={{ color: 'red', fontSize: '0.9rem' }}>No options configured for this question.</p>}
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
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Sticky Action Bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '1rem 1.5rem', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -4px 15px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'flex-end', zIndex: 40 }}>
        {isSearching ? (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              background: '#4f46e5', color: 'white', border: 'none', padding: '1rem 2rem',
              borderRadius: '12px', fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
              width: '100%', maxWidth: 400, boxShadow: '0 4px 15px rgba(79,70,229,0.3)'
            }}
          >
            Done Searching
          </button>
        ) : (
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
        )}
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
