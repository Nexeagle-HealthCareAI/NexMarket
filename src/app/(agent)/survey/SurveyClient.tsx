'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import { useAgentStore } from '@/store/agent-store';

const questions = [
  { id: 'q1', icon: '🩺', text: 'What are the most common health problems people in this area currently deal with?', type: 'text' },
  { id: 'q2', icon: '🏥', text: 'Where do people usually go when they need treatment beyond what is available here?', type: 'text' },
  { id: 'q3', icon: '🧳', text: 'Roughly how many people a month need to travel outside for surgery or specialist treatment?', type: 'number' },
  { id: 'q4', icon: '💧', text: 'Do you commonly see or hear about kidney stone, urinary, or prostate problems here?', type: 'options', options: ['Yes, very common', 'Sometimes', 'Rarely', 'No'] },
  { id: 'q5', icon: '🚰', text: 'What is the main drinking water source here?', type: 'options', options: ['Hand Pump', 'Piped Water', 'River', 'Other'] },
  { id: 'q6', icon: '🤝', text: 'Who do people trust most when deciding where to go for treatment?', type: 'options', options: ['ASHA Worker', 'Local Doctor (RMP)', 'Family/Friends', 'Mukhiya/Sarpanch'] },
  { id: 'q7', icon: '💳', text: 'Have people here used an Ayushman Bharat/PM-JAY card for treatment?', type: 'options', options: ['Yes, frequently', 'Yes, but rarely', 'No, they dont know how', 'No, they dont have cards'] },
  { id: 'q8', icon: '🚧', text: 'What stops people from going to a hospital for specialist care when they need it?', type: 'text' },
  { id: 'q9', icon: '📞', text: 'Would you be open to referring a patient to a specialist hospital if you could call and check with the doctor first?', type: 'options', options: ['Yes, absolutely', 'Maybe, need to see first', 'No'] },
  { id: 'q10', icon: '🏆', text: 'Is there another hospital or clinic people here currently prefer, and why?', type: 'text' },
  { id: 'q11', icon: '🚑', text: 'When someone has a medical emergency here, how do they currently reach a hospital?', type: 'options', options: ['Private Vehicle', 'Shared Auto/Jeep', 'Govt Ambulance (108)', 'No reliable option'] },
  { id: 'q12', icon: '⏱️', text: 'How long does it typically take to get someone to a hospital in an emergency from here?', type: 'text' },
  { id: 'q13', icon: '⚠️', text: 'Has anyone here suffered serious harm due to delay in reaching a hospital? (Log pattern only)', type: 'text' },
];

export default function SurveyClient() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const deviceId = useAgentStore((s) => s.deviceId);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Hide sidebar for this page for full immersion
    document.body.classList.add('survey-mode');
    return () => {
      document.body.classList.remove('survey-mode');
    };
  }, []);

  const handleNext = async () => {
    const q = questions[currentIdx];
    const newAnswers = { ...answers, [q.id]: inputValue };
    setAnswers(newAnswers);
    setInputValue('');

    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      await submitSurvey(newAnswers);
    }
  };

  const handleOption = async (opt: string) => {
    const q = questions[currentIdx];
    const newAnswers = { ...answers, [q.id]: opt };
    setAnswers(newAnswers);
    
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      await submitSurvey(newAnswers);
    }
  };

  const submitSurvey = async (finalAnswers: Record<string, string>) => {
    if (!agentId || !deviceId) return;
    setIsSubmitting(true);
    try {
      const clientId = uuidv4();
      
      // Look up active visit/panchayat context
      const shifts = await db.shifts.where('agentId').equals(agentId).toArray();
      const activeShift = shifts.find(s => !s.endAt);
      const visits = await db.visits.where('agentId').equals(agentId).toArray();
      const activeVisit = visits.find(v => !v.checkOutAt);

      const surveyRecord = {
        clientId,
        deviceId,
        agentId,
        panchayatId: activeVisit?.panchayatId,
        answersJson: JSON.stringify(finalAnswers),
        createdAt: new Date().toISOString(),
      };

      await db.surveyResponses.add(surveyRecord);
      await addToOutbox(clientId, deviceId, 'survey', surveyRecord);
      
      router.push('/home');
    } catch (e) {
      console.error(e);
      setIsSubmitting(false);
    }
  };

  const q = questions[currentIdx];
  const progress = ((currentIdx) / questions.length) * 100;

  if (isSubmitting) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-900)' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
          <span style={{ fontSize: '3rem' }}>⏳</span>
        </motion.div>
        <h2 style={{ color: 'white', marginTop: '1rem' }}>Saving Survey...</h2>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100%', background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      
      {/* Progress Bar */}
      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.2)' }}>
        <motion.div 
          initial={{ width: 0 }} 
          animate={{ width: `${progress}%` }} 
          transition={{ duration: 0.3 }}
          style={{ height: '100%', background: '#fbbf24' }} 
        />
      </div>

      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1rem', cursor: 'pointer', opacity: 0.7 }}>✕ Cancel</button>
        <span style={{ fontWeight: 600, opacity: 0.8 }}>{currentIdx + 1} of {questions.length}</span>
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
            <div style={{ fontSize: '4rem', marginBottom: '1rem', textAlign: 'center' }}>{q.icon}</div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.3, marginBottom: '2rem', textAlign: 'center' }}>
              {q.text}
            </h1>

            {q.type === 'options' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {q.options!.map((opt, i) => (
                  <motion.button
                    key={opt}
                    whileHover={{ scale: 1.02, background: 'rgba(255,255,255,0.2)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleOption(opt)}
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
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && inputValue && handleNext()}
                    placeholder="Type a number..."
                    style={{ background: 'transparent', border: 'none', borderBottom: '3px solid rgba(255,255,255,0.3)', color: 'white', fontSize: '2rem', padding: '1rem 0', outline: 'none', textAlign: 'center' }}
                  />
                ) : (
                  <textarea 
                    autoFocus
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Type your answer here..."
                    rows={3}
                    style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: 'white', fontSize: '1.2rem', padding: '1rem', outline: 'none', resize: 'none', width: '100%' }}
                  />
                )}
                
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleNext}
                    disabled={!inputValue.trim()}
                    style={{
                      background: inputValue.trim() ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                      color: inputValue.trim() ? '#7c3aed' : 'rgba(255,255,255,0.5)',
                      border: 'none',
                      padding: '1rem 3rem',
                      borderRadius: '30px',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                      cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    OK ➔
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
