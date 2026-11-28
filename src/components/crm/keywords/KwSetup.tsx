'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, useLoader } from '@/components/crm/ui';
import { TopicModal } from './TopicView';
import { num, type KwStatus, type OppRes, type Person } from './shared';

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'never');

/** Where keywords come from, the hospital's own name (so name searches are told apart), and the topic list. */
export function KwSetup({ status, people, editable, onChanged, onOpen, toast }: {
  status: KwStatus | null; people: Person[]; editable: boolean; onChanged: () => void; onOpen: (id: string) => void; toast: (m: string) => void;
}) {
  const [brand, setBrand] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const topics = useLoader(() => crm.get<OppRes>('/api/v1/keywords/opportunities?all=true'));
  const brandText = brand ?? status?.brand ?? '';

  const saveBrand = async () => {
    setSaving(true);
    try { await crm.put('/api/v1/keywords/settings', { brand: brandText }); toast('Saved. It applies from the next refresh.'); onChanged(); }
    catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };

  const g = status?.google;
  const sources: { key: string; label: string; on: boolean; note: string }[] = [
    { key: 'gsc', label: 'Search Console', on: !!g?.gsc, note: 'What people typed before seeing the website, and its position' },
    { key: 'gbp', label: 'Business Profile', on: !!g?.gbp, note: 'Words used on Search and Maps before seeing the listing' },
    { key: 'ads', label: 'Google Ads search terms', on: !!g?.ads, note: 'What people typed before an ad showed' },
    { key: 'planner', label: 'Keyword Planner', on: !!g?.ads && !!g?.developerToken, note: 'New ideas and searches a month, across Bihar and per district, weekly' },
    { key: 'chats', label: 'WhatsApp messages', on: true, note: 'Phrases 3 or more people wrote, as counts only, never names or numbers' },
  ];

  return (
    <div className="kw-stack">
      <section className="crm-card kw-card kw-pad" aria-labelledby="kw-src">
        <h2 id="kw-src" className="crm-h2">Where keywords come from</h2>
        <ul className="kw-src-list">
          {sources.map((s) => (
            <li key={s.key}>
              {s.on ? <CheckCircle2 size={18} aria-hidden className="is-ok" /> : <CircleDashed size={18} aria-hidden />}
              <span><strong>{s.label}</strong><span className="kw-meta">{s.note}</span></span>
              <span className="kw-src-n">{s.on ? `${num(status?.sources[s.key] ?? 0)} keywords` : 'Not connected'}</span>
            </li>
          ))}
        </ul>
        {g && (!g.gsc || !g.gbp || !g.ads) && <p className="crm-sub" style={{ margin: 0 }}>Connect the missing ones in <Link className="wa-link" href="/admin/google?tab=setup">Google → Setup</Link>. Keyword Planner uses the same Google Ads account and developer token.</p>}
        <p className="crm-sub" style={{ margin: 0 }}>
          Last refresh {when(status?.runAt)} (every morning with the Google fetch). Keyword Planner last ran {when(status?.plannerAt)}
          {status?.plannerResult && status.plannerResult !== 'ok' ? <>: <span className="kw-warn">{status.plannerResult}</span></> : '.'}
          {status && status.places.length > 0 ? ` Districts found for Keyword Planner: ${status.places.filter((p) => p !== 'Bihar').join(', ')}.` : ''}
        </p>
        <p className="crm-sub" style={{ margin: 0 }}>{num(status?.keywords)} keywords · {num(status?.grouped)} in a topic · {num(status?.withVolume)} with Keyword Planner figures.</p>
      </section>

      <section className="crm-card kw-card kw-pad" aria-labelledby="kw-brand">
        <h2 id="kw-brand" className="crm-h2">The hospital’s own name</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Searches for your name are marked “Our name”, so they don’t count as new demand. Add each spelling people use, one per line.</p>
        <label className="crm-field">Name words
          <textarea className="crm-textarea" rows={3} value={brandText} disabled={!editable} onChange={(e) => setBrand(e.target.value)} placeholder={'glisan\nग्लिसन'} />
        </label>
        {editable && <button type="button" className="crm-btn is-sm" disabled={saving} onClick={() => void saveBrand()} style={{ alignSelf: 'flex-start' }}>{saving ? 'Saving…' : 'Save'}</button>}
      </section>

      <section className="crm-card kw-card" aria-labelledby="kw-topics">
        <div className="kw-card-head">
          <div>
            <h2 id="kw-topics" className="crm-h2">Topics</h2>
            <p className="crm-sub">NexMarket starts with the common hospital topics. Add your own (a new service, a specialist) or mark one “Not for us”.</p>
          </div>
          {editable && <button type="button" className="crm-btn" onClick={() => setAdding(true)}>New topic</button>}
        </div>
        <div className="crm-table-wrap">
          <table className="crm-table kw-table">
            <thead><tr><th scope="col">Topic</th><th scope="col">Department</th><th scope="col">Keywords</th><th scope="col">Searches / month</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {topics.data?.topics.map((t) => (
                <tr key={t.id}>
                  <td><button type="button" className="kw-topic-link" onClick={() => onOpen(t.id)}>{t.name}</button></td>
                  <td>{t.department ?? '—'}</td>
                  <td>{t.keywords}</td>
                  <td>{num(t.demand)}</td>
                  <td>{t.status === 'dismissed' ? 'Not for us' : t.status[0].toUpperCase() + t.status.slice(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {adding && <TopicModal people={people} onClose={() => setAdding(false)} onSaved={(m, id) => { setAdding(false); toast(m); void topics.reload(); if (id) onOpen(id); }} />}
    </div>
  );
}
