'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { db, useActiveVisit } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useAgentStore } from '@/store/agent-store';
import { useTranslations } from '@/i18n/I18nProvider';
import { useLiveQuery } from 'dexie-react-hooks';

type Answer = string | number | string[];

// An option literally named "Other" (any casing) is treated as a write-in —
// selecting it reveals a text box instead of being a normal fixed choice.
function isOtherOption(opt: unknown): boolean {
  return typeof opt === 'string' && opt.trim().toLowerCase() === 'other';
}

interface SurveyQuestion {
  id: string;
  text: string;
  type: string;
  options?: string[];
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

  // Fallback to legacy translation questions if no dynamic questions exist
  const QUESTIONS: SurveyQuestion[] = dynamicQuestions?.length ? dynamicQuestions.map(q => ({
    id: q.questionId,
    text: q.text,
    type: q.type,
    options: q.optionsJson ? (JSON.parse(q.optionsJson) as string[]) : undefined,
    isOptional: q.isOptional
  })) : [
    { id: 'q1', text: t.q1, type: 'single', options: [t.q1_o1, t.q1_o2, t.q1_o3, t.q1_o4] },
    { id: 'q2', text: t.q2, type: 'single', options: [t.q2_o1, t.q2_o2, t.q2_o3, t.q2_o4] },
    { id: 'q3', text: t.q3, type: 'single', options: [t.q3_o1, t.q3_o2, t.q3_o3, t.q3_o4] },
    { id: 'q4', text: t.q4, type: 'single', options: [t.q4_o1, t.q4_o2, t.q4_o3, t.q4_o4] },
    { id: 'q5', text: t.q5, type: 'single', options: [t.q5_o1, t.q5_o2, t.q5_o3, t.q5_o4] },
    { id: 'q6', text: t.q6, type: 'text' }
  ];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, Answer>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showSkipPrompt, setShowSkipPrompt] = useState(false);
  const [skipReason, setSkipReason] = useState<string>('');
  const [submitError, setSubmitError] = useState('');

  // Fallback to URL param if prop isn't provided
  const contactId = initialContactId || searchParams.get('contactId') || undefined;

  useEffect(() => {
    document.body.classList.add('survey-mode');
    return () => {
      document.body.classList.remove('survey-mode');
    };
  }, []);

  const handleInput = (val: Answer) => {
    setResponses({ ...responses, [QUESTIONS[currentIdx].id]: val });
  };

  const handleNext = async () => {
    if (currentIdx < QUESTIONS.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      await submitSurvey();
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
      // Previously silent (console.error only) — the spinner would vanish and
      // the question form would just reappear with no sign the save failed,
      // easily read as "it saved" when the response was actually lost.
      console.error(e);
      setSubmitError('Could not save this response. Please try again.');
      setLoading(false);
    }
  };

  // Wait for dynamic questions to load if they are still undefined (useLiveQuery initial state)
  if (dynamicQuestions === undefined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)' }}>
        <h2 style={{ color: 'white' }}>Loading Questions...</h2>
      </div>
    );
  }

  const q = QUESTIONS[currentIdx];
  const progress = ((currentIdx) / QUESTIONS.length) * 100;

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

  return (
    <div style={{ height: '100vh', width: '100%', background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      
      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.2)' }}>
        <motion.div 
          initial={{ width: 0 }} 
          animate={{ width: `${progress}%` }} 
          transition={{ duration: 0.3 }}
          style={{ height: '100%', background: '#fbbf24' }} 
        />
      </div>

      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
        <button onClick={() => { if (onClose) onClose(); else router.back(); }} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', opacity: 0.7 }}>{t.surveyCancel}</button>
        <span style={{ fontWeight: 600, opacity: 0.8 }}>{currentIdx + 1} of {QUESTIONS.length}</span>
        <button onClick={() => setShowSkipPrompt(true)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}>{t.skipSurvey || 'Skip Survey'}</button>
      </div>

      {submitError && (
        <div style={{ margin: '0 1rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', color: 'white', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center' }}>
          ⚠️ {submitError}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIdx}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ width: '100%', maxWidth: 600 }}
          >
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.3, marginBottom: '2rem', textAlign: 'center' }}>
              {q.text}
            </h1>

            {q.type === 'single' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {q.options!.map((opt, i) => {
                  const isOther = isOtherOption(opt);
                  const selected = responses[q.id] === opt;
                  return (
                    <motion.button
                      key={opt}
                      whileHover={{ scale: 1.02, background: 'rgba(255,255,255,0.2)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        handleInput(opt);
                        // "Other" needs a moment for the agent to type before
                        // advancing — every other option still advances instantly.
                        if (!isOther) handleNext();
                      }}
                      style={{
                        background: selected ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.1)',
                        border: selected ? '2px solid #fbbf24' : '2px solid rgba(255,255,255,0.2)',
                        padding: '1.25rem',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '1.2rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                      }}
                    >
                      <span style={{ background: 'rgba(255,255,255,0.2)', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      {opt}
                    </motion.button>
                  );
                })}

                {isOtherOption(responses[q.id]) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <textarea
                      autoFocus
                      value={otherText[q.id] || ''}
                      onChange={(e) => setOtherText({ ...otherText, [q.id]: e.target.value })}
                      placeholder="Please specify"
                      rows={2}
                      style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: 'white', fontSize: '1.1rem', padding: '1rem', outline: 'none', resize: 'none', width: '100%' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleNext}
                        disabled={!otherText[q.id]?.trim()}
                        style={{
                          background: otherText[q.id]?.trim() ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                          color: otherText[q.id]?.trim() ? '#7c3aed' : 'rgba(255,255,255,0.5)',
                          border: 'none',
                          padding: '1rem 3rem',
                          borderRadius: '30px',
                          fontSize: '1.2rem',
                          fontWeight: 800,
                          cursor: otherText[q.id]?.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {t.okNext}
                      </motion.button>
                    </div>
                  </div>
                )}
              </div>
            ) : q.type === 'multi' ? (
              (() => {
                const multiSelected = Array.isArray(responses[q.id]) ? (responses[q.id] as string[]) : [];
                const multiHasOther = multiSelected.some(isOtherOption);
                const multiCanContinue = (q.isOptional || multiSelected.length > 0) && (!multiHasOther || !!otherText[q.id]?.trim());

                return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {q.options!.map((opt) => {
                  const selected = Array.isArray(responses[q.id]) && (responses[q.id] as string[]).includes(opt);
                  return (
                    <motion.button
                      key={opt}
                      whileHover={{ scale: 1.02, background: 'rgba(255,255,255,0.2)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        const current = Array.isArray(responses[q.id]) ? (responses[q.id] as string[]) : [];
                        handleInput(selected ? current.filter((o) => o !== opt) : [...current, opt]);
                      }}
                      style={{
                        background: selected ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.1)',
                        border: selected ? '2px solid #fbbf24' : '2px solid rgba(255,255,255,0.2)',
                        padding: '1.25rem',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '1.2rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                      }}
                    >
                      <span style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        border: '2px solid rgba(255,255,255,0.6)',
                        background: selected ? '#fbbf24' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1rem', fontWeight: 800, color: '#7c3aed',
                      }}>
                        {selected ? '✓' : ''}
                      </span>
                      {opt}
                    </motion.button>
                  );
                })}

                {multiHasOther && (
                  <textarea
                    autoFocus
                    value={otherText[q.id] || ''}
                    onChange={(e) => setOtherText({ ...otherText, [q.id]: e.target.value })}
                    placeholder="Please specify"
                    rows={2}
                    style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: 'white', fontSize: '1.1rem', padding: '1rem', outline: 'none', resize: 'none', width: '100%' }}
                  />
                )}

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleNext}
                    disabled={!multiCanContinue}
                    style={{
                      background: multiCanContinue ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                      color: multiCanContinue ? '#7c3aed' : 'rgba(255,255,255,0.5)',
                      border: 'none',
                      padding: '1rem 3rem',
                      borderRadius: '30px',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                      cursor: multiCanContinue ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {t.okNext}
                  </motion.button>
                </div>
              </div>
                );
              })()
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {q.type === 'number' ? (
                  <input 
                    type="number"
                    autoFocus
                    value={responses[q.id] as number || ''}
                    onChange={(e) => handleInput(Number(e.target.value))}
                    placeholder={t.typeNumber}
                    style={{ background: 'transparent', border: 'none', borderBottom: '3px solid rgba(255,255,255,0.3)', color: 'white', fontSize: '2rem', padding: '1rem 0', outline: 'none', textAlign: 'center' }}
                  />
                ) : (
                  <textarea 
                    autoFocus
                    value={responses[q.id] as string || ''}
                    onChange={(e) => handleInput(e.target.value)}
                    placeholder={t.typeAnswer}
                    rows={3}
                    style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: 'white', fontSize: '1.2rem', padding: '1rem', outline: 'none', resize: 'none', width: '100%' }}
                  />
                )}
                
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleNext}
                    disabled={!q.isOptional && !responses[q.id]}
                    style={{
                      background: (q.isOptional || responses[q.id]) ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                      color: (q.isOptional || responses[q.id]) ? '#7c3aed' : 'rgba(255,255,255,0.5)',
                      border: 'none',
                      padding: '1rem 3rem',
                      borderRadius: '30px',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                      cursor: (q.isOptional || responses[q.id]) ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    {loading ? t.savingSurvey : (q.isOptional && !responses[q.id] ? 'Skip (Optional)' : t.okNext)}
                  </motion.button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Skip Prompt Overlay */}
      <AnimatePresence>
        {showSkipPrompt && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', zIndex: 50 }}
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
