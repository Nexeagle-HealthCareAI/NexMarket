'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { db, useActiveVisit } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useAgentStore } from '@/store/agent-store';
import { useTranslations } from '@/i18n/I18nProvider';

type Answer = string | number | string[];

export default function SurveyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeVisit = useActiveVisit(agentId ?? undefined);

  const QUESTIONS = [
    { id: 'q1', text: t.q1, type: 'text' },
    { id: 'q2', text: t.q2, type: 'text' },
    { id: 'q3', text: t.q3, type: 'number' },
    { id: 'q4', text: t.q4, type: 'single', options: [t.q4_o1, t.q4_o2, t.q4_o3, t.q4_o4] },
    { id: 'q5', text: t.q5, type: 'single', options: [t.q5_o1, t.q5_o2, t.q5_o3, t.q5_o4] },
    { id: 'q6', text: t.q6, type: 'single', options: [t.q6_o1, t.q6_o2, t.q6_o3, t.q6_o4] },
    { id: 'q7', text: t.q7, type: 'single', options: [t.q7_o1, t.q7_o2, t.q7_o3, t.q7_o4] },
    { id: 'q8', text: t.q8, type: 'text' },
    { id: 'q9', text: t.q9, type: 'single', options: [t.q9_o1, t.q9_o2, t.q9_o3] },
    { id: 'q10', text: t.q10, type: 'text' },
    { id: 'q11', text: t.q11, type: 'single', options: [t.q11_o1, t.q11_o2, t.q11_o3, t.q11_o4] },
    { id: 'q12', text: t.q12, type: 'text' },
    { id: 'q13', text: t.q13, type: 'text' }
  ];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(false);

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

  const submitSurvey = async () => {
    if (!agentId || !deviceId) return;
    setLoading(true);
    try {
      const clientId = uuidv4();
      const responsesRecord = Object.fromEntries(
        Object.entries(responses).map(([k, v]) => [k, String(v)])
      );

      const surveyRecord = {
        clientId,
        deviceId,
        agentId,
        panchayatId: activeVisit?.panchayatId,
        answersJson: JSON.stringify(responsesRecord),
        createdAt: new Date().toISOString(),
      };

      await db.surveyResponses.add(surveyRecord);
      await addToOutbox(clientId, deviceId, 'survey', surveyRecord);
      router.push('/home');
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

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

      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', opacity: 0.7 }}>{t.surveyCancel}</button>
        <span style={{ fontWeight: 600, opacity: 0.8 }}>{currentIdx + 1} of {QUESTIONS.length}</span>
      </div>

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
                {q.options!.map((opt, i) => (
                  <motion.button
                    key={opt}
                    whileHover={{ scale: 1.02, background: 'rgba(255,255,255,0.2)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { handleInput(opt); handleNext(); }}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '2px solid rgba(255,255,255,0.2)',
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
                ))}
              </div>
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
                    disabled={!responses[q.id]}
                    style={{
                      background: responses[q.id] ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                      color: responses[q.id] ? '#7c3aed' : 'rgba(255,255,255,0.5)',
                      border: 'none',
                      padding: '1rem 3rem',
                      borderRadius: '30px',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                      cursor: responses[q.id] ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    {loading ? t.savingSurvey : t.okNext}
                  </motion.button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
