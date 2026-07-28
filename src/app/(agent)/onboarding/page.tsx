'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import { completeProfile, uploadPhoto } from '@/lib/sync/api-client';

export default function OnboardingPage() {
  const router = useRouter();
  const { agentId, jwtToken, profileCompleted, setProfileCompleted } = useAgentStore();

  const [step, setStep] = useState(1);
  const [personalDetails, setPersonalDetails] = useState('');
  const [education, setEducation] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.style.background = '#020617';
    return () => { document.body.style.background = ''; };
  }, []);

  useEffect(() => {
    if (profileCompleted) {
      router.push('/home');
    }
  }, [profileCompleted, router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleNext = () => {
    if (step === 1 && !personalDetails.trim()) {
      setError('Please provide your personal details to continue.');
      return;
    }
    if (step === 2 && !education.trim()) {
      setError('Please provide your education details to continue.');
      return;
    }
    setError('');
    setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    if (!photoFile) {
      setError('A profile photo is required to complete onboarding.');
      return;
    }
    if (!agentId || !jwtToken) return;
    
    setLoading(true);
    setError('');
    
    try {
      const { url: photoUrl } = await uploadPhoto(jwtToken, photoFile);

      await completeProfile(agentId, jwtToken, {
        personalDetails,
        education,
        photoUrl
      });

      setProfileCompleted(true);
      router.push('/home');

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An error occurred during onboarding.');
      setLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginBottom: '2.5rem' }}>
      {[1, 2, 3].map((num) => (
        <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <motion.div 
            animate={{ 
              background: step >= num ? '#6366f1' : 'rgba(255,255,255,0.05)',
              borderColor: step >= num ? '#6366f1' : 'rgba(255,255,255,0.1)',
              scale: step === num ? 1.1 : 1
            }}
            style={{ 
              width: '2.5rem', height: '2.5rem', borderRadius: '50%', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid', color: step >= num ? 'white' : 'rgba(255,255,255,0.4)',
              fontWeight: 700, fontSize: '0.9rem',
              boxShadow: step === num ? '0 0 20px rgba(99,102,241,0.4)' : 'none'
            }}
          >
            {step > num ? '✓' : num}
          </motion.div>
          {num !== 3 && (
            <div style={{ width: '3rem', height: '2px', background: step > num ? '#6366f1' : 'rgba(255,255,255,0.05)' }} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#020617', color: 'white', position: 'fixed', top: 0, left: 0, zIndex: 100000, overflow: 'auto' }}>
      
      {/* Premium Background Effects */}
      <div style={{ position: 'fixed', top: '-10%', left: '-10%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(2,6,23,0) 70%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-10%', right: '-10%', width: '60vw', height: '60vw', background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, rgba(2,6,23,0) 70%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', position: 'relative', zIndex: 1 }}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ width: '100%', maxWidth: 540, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '3rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
        >
          
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 800, marginBottom: '0.5rem', background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>
              Welcome to NexMarket
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '1.05rem', fontWeight: 400 }}>Set up your professional profile to begin.</p>
          </div>

          {renderStepIndicator()}

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>Personal Information</h2>
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Please provide your current address and a short bio about yourself.</p>
                </div>
                
                <textarea 
                  rows={4}
                  value={personalDetails}
                  onChange={e => setPersonalDetails(e.target.value)}
                  placeholder="e.g. Based in Purnea, working in public health..."
                  style={{ width: '100%', padding: '1.25rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '1rem', outline: 'none', resize: 'vertical', transition: 'border-color 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}
                  onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>Education Details</h2>
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>What is your highest level of education?</p>
                </div>
                
                <input 
                  type="text"
                  value={education}
                  onChange={e => setEducation(e.target.value)}
                  placeholder="e.g. Bachelor of Science in Nursing"
                  style={{ width: '100%', padding: '1.25rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}
                  onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '2rem', alignItems: 'center' }}
              >
                <div style={{ textAlign: 'center' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>Professional Photo</h2>
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Upload a clear, well-lit photo of your face.</p>
                </div>
                
                <motion.div 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ 
                    width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', 
                    border: '2px dashed rgba(99,102,241,0.5)', display: 'flex', alignItems: 'center', 
                    justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', position: 'relative',
                    boxShadow: photoPreview ? '0 10px 25px rgba(0,0,0,0.3)' : 'none'
                  }}
                >
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#6366f1' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: '0.5rem' }}>Upload Image</span>
                    </div>
                  )}
                </motion.div>
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ marginTop: '1.5rem', overflow: 'hidden' }}
              >
                <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', fontWeight: 500 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {step > 1 ? (
              <button 
                onClick={() => { setStep(s => s - 1); setError(''); }}
                style={{ padding: '0.85rem 1.5rem', borderRadius: '12px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', outline: 'none' }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}
              >
                Go Back
              </button>
            ) : <div />}

            <button 
              onClick={step === 3 ? handleSubmit : handleNext}
              disabled={loading}
              style={{ padding: '0.85rem 2rem', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: 'white', border: 'none', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px 0 rgba(99, 102, 241, 0.39)', transition: 'all 0.2s', outline: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onMouseOver={(e) => !loading && (e.currentTarget.style.transform = 'translateY(-1px)', e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)')}
              onMouseOut={(e) => !loading && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 4px 14px 0 rgba(99, 102, 241, 0.39)')}
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Processing...
                </>
              ) : step === 3 ? (
                'Complete Profile'
              ) : (
                <>
                  Continue
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </>
              )}
            </button>
          </div>
          
        </motion.div>
      </div>
    </div>
  );
}
