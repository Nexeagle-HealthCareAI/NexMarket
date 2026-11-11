'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError } from '@/components/crm/ui';
import type { ActionRow, AgentRow, Overview, QuickKey, Whereabouts } from '../shared';
import { lookOf, QUICK, quickAnswer } from '../shared';

const PLACE: Record<Whereabouts['place'], string> = { desk: 'At her desk', pool: 'At the pool party', lounge: 'In the lounge', meeting: 'In the meeting room', walking: 'Walking' };

/**
 * Opens when you tap a Vita: who she is, where she is, and her answers. The ready questions are answered from the
 * agent's live state (no AI); a typed question goes to the AI with that same state and nothing else.
 */
export function AgentCard({ a, data, where, feed, onClose }: { a: AgentRow; data: Overview; where: Whereabouts; feed: ActionRow[]; onClose: () => void }) {
  const l = lookOf(a, data.stopAll.on);
  const nameOf = (id: string) => data.agents.find((x) => x.id === id)?.name ?? id;
  const ctx = { stopAll: data.stopAll.on, groq: data.groq, where, feed, nameOf };
  const [asked, setAsked] = useState<{ q: string; key?: QuickKey; text?: string; busy?: boolean; error?: boolean }>({ q: 'What are you doing?', key: 'now' });
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  // A ready question stays live: if she walks off to the pool, the answer follows.
  const answer = asked.key ? quickAnswer(asked.key, a, ctx) : asked.text ?? '';
  useEffect(() => { box.current?.scrollTo({ top: 0 }); }, [asked.q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ask = async () => {
    const q = text.trim();
    if (!q || asked.busy) return;
    setText(''); setAsked({ q, busy: true });
    try {
      const r = await crm.post<{ answer: string }>(`/api/v1/ai-agents/agents/${a.id}/ask`, { question: q, where: where.doing });
      setAsked({ q, text: r.answer });
    } catch (e) {
      setAsked({ q, text: friendlyError(e), error: true });
    }
  };

  return (
    <section className="ai-ask" aria-label={`Ask ${a.name}`}>
      <header>
        <img src={l.img} alt="" />
        <div>
          <strong>{a.name}</strong>
          <span>{a.wingName} · <span className={`ai-dot is-${l.tone}`} aria-hidden /> {l.label} · {PLACE[where.place]}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="ai-ask-body" ref={box} aria-live="polite">
        <p className="ai-ask-q">{asked.q}</p>
        <p className={`ai-ask-a${asked.error ? ' is-error' : ''}`}>{asked.busy ? <span className="ai-ask-dots" aria-label="Thinking"><i /><i /><i /></span> : answer}</p>
        {!asked.key && !asked.busy && !asked.error && <span className="ai-ask-note">Written by AI from {a.name}&apos;s job, limits, today&apos;s numbers and latest actions.</span>}
      </div>
      <div className="ai-ask-chips" role="group" aria-label="Ready questions">
        {QUICK.map((x) => <button key={x.k} type="button" aria-pressed={asked.key === x.k} onClick={() => setAsked({ q: x.q, key: x.k })}>{x.q}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={`Ask ${a.name} anything…`} aria-label={`Ask ${a.name} anything`} />
        <button type="submit" disabled={!text.trim() || asked.busy} aria-label="Ask"><Send size={16} /></button>
      </form>
    </section>
  );
}
