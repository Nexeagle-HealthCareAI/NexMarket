'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, Star } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { orgName } from '@/lib/crm/access';
import { n0, when, type GoogleStatus } from './shared';

interface Review { id: string; reviewer?: string | null; stars: number; comment?: string | null; postedAt: string; reply?: string | null; repliedAt?: string | null; repliedBy?: string | null }
interface Res { status: GoogleStatus; counts: { all: number; unanswered: number; low: number; stars: { stars: number; count: number }[] }; items: Review[] }

const SHOWS = [{ k: 'unanswered', l: 'No reply yet' }, { k: 'low', l: '3 stars or less' }, { k: '', l: 'All' }] as const;

/** Starting points for a reply. They never mention illness or treatment: a public reply must not confirm someone was a patient. */
const STARTERS = [
  { l: 'Thank you', t: (n: string) => `Thank you${n ? `, ${n}` : ''}, for your kind words. Our team will be glad to hear it. We wish you good health. – ${orgName()}` },
  { l: 'Sorry, please call us', t: (n: string) => `Dear ${n || 'reviewer'}, we are sorry to read this. We take every concern seriously and would like to understand what happened. Please call our patient help desk so we can look into it personally. – ${orgName()}` },
];

const stars = (n: number) => <span className="gg-stars" aria-label={`${n} of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={14} aria-hidden fill={i <= n ? '#f2a600' : 'none'} color={i <= n ? '#f2a600' : 'var(--border)'} />)}</span>;
const firstName = (s?: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? '';

/** Google reviews of the hospital, with the hospital's replies; the desk answers from here and the reply appears on Google. */
export function GoogleReviews({ canReply, onTab, toast }: { canReply: boolean; onTab: (t: string) => void; toast: (m: string) => void }) {
  const [show, setShow] = useState<string>('unanswered');
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/google/reviews${show ? `?show=${show}` : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [show]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const send = async (r: Review) => {
    setBusy(true);
    try {
      const res = await crm.post<{ reply: string; repliedAt: string; repliedBy: string }>(`/api/v1/google/reviews/${r.id}/reply`, { text });
      setData((d) => d && ({ ...d, items: d.items.map((x) => x.id === r.id ? { ...x, ...res } : x), counts: { ...d.counts, unanswered: r.reply ? d.counts.unanswered : Math.max(0, d.counts.unanswered - 1) } }));
      setOpen(null); setText('');
      toast('Reply posted on Google.');
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={480} />;
  if (!data.status.sources.gbp) {
    return (
      <section className="crm-card">
        <Empty title="No Business Profile picked">
          <span className="crm-sub">Pick the hospital&apos;s Google Business Profile in Setup to see its reviews here and reply to them.</span>
          {data.status.isAdmin && <button type="button" className="crm-btn is-sm" onClick={() => onTab('setup')}>Open Setup</button>}
        </Empty>
      </section>
    );
  }
  const max = Math.max(1, ...data.counts.stars.map((s) => s.count));

  return (
    <div className="gg-reviews">
      <section className="crm-card so-card gg-rv-side">
        <h2 className="crm-h2" style={{ margin: 0 }}>{n0.format(data.counts.all)} reviews</h2>
        <ul className="gg-starbars">
          {data.counts.stars.map((s) => (
            <li key={s.stars}><span>{s.stars} ★</span><span className="sp-topic-bar"><span style={{ width: `${(s.count / max) * 100}%`, background: '#f2a600' }} /></span><span className="crm-sub">{n0.format(s.count)}</span></li>
          ))}
        </ul>
        <p className="crm-sub gg-rule"><ShieldAlert size={15} aria-hidden /> Replies are public. Never mention an illness, treatment, test or bill, or confirm that the person was a patient. Thank them, or ask them to call the help desk.</p>
      </section>

      <div className="gg-rv-main">
        <div className="crm-chips" role="group" aria-label="Show">
          {SHOWS.map((s) => (
            <button key={s.k} type="button" className="crm-chip" aria-pressed={show === s.k} onClick={() => setShow(s.k)}>
              {s.l}{s.k === 'unanswered' ? ` · ${data.counts.unanswered}` : s.k === 'low' ? ` · ${data.counts.low}` : ''}
            </button>
          ))}
        </div>
        {data.items.length === 0 ? (
          <section className="crm-card"><Empty title={show === 'unanswered' ? 'Every review has a reply' : 'No reviews here'} /></section>
        ) : data.items.map((r) => (
          <article key={r.id} className={`crm-card gg-review${r.stars > 0 && r.stars <= 3 ? ' is-low' : ''}`}>
            <header>
              <strong>{r.reviewer || 'A Google user'}</strong>
              {stars(r.stars)}
              <span className="crm-sub">{when(r.postedAt)}</span>
            </header>
            {r.comment ? <p className="gg-review-text">{r.comment}</p> : <p className="crm-sub" style={{ margin: 0 }}>Rating only, no words.</p>}
            {r.reply && open !== r.id && (
              <div className="gg-reply"><span className="crm-sub"><CheckCircle2 size={13} aria-hidden /> Hospital replied {when(r.repliedAt)}{r.repliedBy ? ' from NexMarket' : ''}</span><p>{r.reply}</p></div>
            )}
            {canReply && open !== r.id && (
              <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(r.id); setText(r.reply ?? ''); }}>
                {r.reply ? 'Change reply' : 'Reply'}
              </button>
            )}
            {open === r.id && (
              <div className="gg-reply-form">
                <div className="crm-chips">{STARTERS.map((s) => <button key={s.l} type="button" className="crm-chip" onClick={() => setText(s.t(firstName(r.reviewer)))}>{s.l}</button>)}</div>
                <label className="crm-field"><span className="crm-sr">Reply</span>
                  <textarea className="crm-input" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the hospital's reply. It appears publicly on Google." />
                </label>
                <div className="sp-actions">
                  <button type="button" className="crm-btn is-sm" disabled={busy || text.trim().length < 2} onClick={() => void send(r)}>{busy ? 'Posting…' : 'Post on Google'}</button>
                  <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
