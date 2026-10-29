'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ArrowUp, Copy, RotateCcw, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { friendlyError } from '@/components/crm/ui';

/**
 * Vita, the market analyst: a chat box on every CRM page. It asks the same AI analyst as Analytics,
 * focused on the area of the page you are on (you can switch). Needs the Analytics page.
 */

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; failed?: boolean };

const AREAS: { k: string; l: string }[] = [
  { k: 'business', l: 'Everything' }, { k: 'partners', l: 'Partners' }, { k: 'field', l: 'Field team' },
  { k: 'referrals', l: 'Referrals' }, { k: 'money', l: 'Money' }, { k: 'surveys', l: 'Surveys' },
];

const SUGGEST: Record<string, string[]> = {
  business: ['What are the 3 most important things to fix this week?', 'How is this month going compared with last month?', 'Which block should we focus on next?'],
  partners: ['Which partners should we call this week?', 'Who signed up but never referred anyone?', 'Which partner type gets patients admitted?'],
  field: ['Which agent needs support, and with what?', 'Which assigned panchayats have never been visited?', 'Who is skipping the survey?'],
  referrals: ['Where are we losing patients before they arrive?', 'Which department gets referrals but few admissions?', 'Which blocks send patients who actually come?'],
  money: ['What is our cost per admission?', 'Who was paid but sent no admitted patients?', 'How much is waiting for approval or overdue?'],
  surveys: ['What should we offer in our weakest block?', 'Where do patients go instead of us?', 'Which illnesses come up most?'],
};

/** The page decides what Vita looks at first. */
function areaFor(path: string): string {
  if (/^\/admin\/(partners|pipeline|duplicates|calls|broadcasts)/.test(path)) return 'partners';
  if (/^\/admin\/(agents|assignments|coverage|panchayats|map|activity|leave)/.test(path)) return 'field';
  if (/^\/admin\/(referrals|desk|hospital-crm|departments)/.test(path)) return 'referrals';
  if (/^\/admin\/payments/.test(path)) return 'money';
  if (/^\/admin\/surveys/.test(path)) return 'surveys';
  return 'business';
}

const STORE = 'vita-chat-v1';
function load(): { turns: Turn[]; open: boolean } {
  try { const v = JSON.parse(sessionStorage.getItem(STORE) ?? 'null'); if (v && Array.isArray(v.turns)) return v; } catch { /* storage off */ }
  return { turns: [], open: false };
}

export default function VitaChat() {
  const { access } = useAccess();
  const path = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [area, setArea] = useState(() => areaFor(path));
  const [picked, setPicked] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Remember the conversation for this browser tab, so moving between pages keeps it.
  useEffect(() => { const v = load(); setTurns(v.turns); setOpen(v.open); }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify({ turns: turns.slice(-30), open })); } catch { /* storage off */ } }, [turns, open]);
  // Follow the page until someone picks an area themselves.
  useEffect(() => { if (!picked) setArea(areaFor(path)); }, [path, picked]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [turns.length, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!access || !canView(access, 'analytics')) return null;

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.filter((t) => !t.failed).slice(-10).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setQ('');
    setBusy(true);
    try {
      const r = await crm.post<{ answer: string; lookedUp: string[] }>('/api/v1/analytics/analyst/ask', { question: text, history, scope: area });
      setTurns((t) => [...t, { role: 'assistant', content: r.answer || 'No answer came back. Try asking another way.', tools: r.lookedUp }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: friendlyError(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button type="button" className="vita-fab" onClick={() => setOpen(true)} aria-label="Ask Vita, the market analyst">
          <span className="vita-fab-img"><Image src="/brand/vita/wave.webp" alt="" width={46} height={46} unoptimized /></span>
          <span className="vita-fab-text"><strong>Ask Vita</strong><span>Market analyst</span></span>
        </button>
      )}
      {open && (
        <section className="vita-panel" role="dialog" aria-label="Vita, market analyst">
          <header className="vita-head">
            <Image src={busy ? '/brand/vita/think.webp' : '/brand/vita/ai.webp'} alt="" width={52} height={52} unoptimized className={busy ? 'vita-bob' : undefined} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Vita <span className="vita-tag">Market analyst</span></strong>
              <span>{busy ? 'Looking at the numbers…' : 'Ask about referrals, partners, agents, money or surveys.'}</span>
            </div>
            {turns.length > 0 && <button type="button" className="vita-icon" onClick={() => setTurns([])} aria-label="New conversation" title="New conversation"><RotateCcw size={16} /></button>}
            <button type="button" className="vita-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
          </header>

          <div className="vita-areas" role="group" aria-label="What Vita looks at">
            {AREAS.map((a) => (
              <button key={a.k} type="button" aria-pressed={area === a.k} onClick={() => { setArea(a.k); setPicked(true); }}>{a.l}</button>
            ))}
          </div>

          <div className="vita-thread" aria-live="polite">
            {turns.length === 0 && (
              <div className="vita-empty">
                <Image src="/brand/vita/wave.webp" alt="" width={110} height={110} unoptimized />
                <p>Namaste! I&apos;m Vita. I read your live numbers before I answer. Try one of these:</p>
                {SUGGEST[area].map((s) => <button key={s} type="button" className="vita-suggest" onClick={() => void ask(s)}>{s}</button>)}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`vita-msg is-${t.role}${t.failed ? ' is-failed' : ''}`}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{t.content}</span>
                {t.role === 'assistant' && !t.failed && (
                  <span className="vita-meta">
                    {t.tools && t.tools.length > 0 ? `Looked up: ${[...new Set(t.tools)].map((x) => x.replace(/^get_/, '').replace(/_/g, ' ')).join(', ')}` : ''}
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(t.content).catch(() => undefined); }} aria-label="Copy answer" title="Copy"><Copy size={13} /></button>
                  </span>
                )}
              </div>
            ))}
            {busy && <div className="vita-msg is-assistant vita-typing" role="status"><i /><i /><i /></div>}
            <div ref={endRef} />
          </div>

          <form className="vita-form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
            <label className="crm-sr" htmlFor="vita-q">Ask Vita</label>
            <textarea id="vita-q" ref={inputRef} rows={1} value={q} maxLength={2000} placeholder="Ask Vita anything about the business…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
          <span className="vita-foot">Only totals and partner and agent names go to the AI. Vita can be wrong; check the numbers before acting.</span>
        </section>
      )}
    </>
  );
}
