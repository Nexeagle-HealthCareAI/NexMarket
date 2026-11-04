'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, MessageSquareReply, Plus, Shuffle, ShieldBan, Trash2, Users } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';

interface Rule { id: string; words: string[]; reply: string; on: boolean }
interface Automation {
  paused: boolean; dailyTemplateLimit: number; officeHoursOn: boolean; officeDays: number[]; officeStart: string; officeEnd: string;
  afterHoursReply?: string | null; keywords: Rule[]; assignMode: string; assignTo: string[]; partnerMessagesAreLeads: boolean;
  replyTargetMinutes: number; stopWords: string[];
}
interface Res { rules: Automation; people: { agentId: string; name: string; role: string }[]; autoReply?: string | null; connected: boolean }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STARTERS: { words: string; reply: string }[] = [
  { words: 'OPD, timing, समय', reply: 'OPD सोमवार से शनिवार, सुबह 9 बजे से दोपहर 2 बजे तक है। अपॉइंटमेंट के लिए अपना नाम और समस्या लिखें।' },
  { words: 'address, location, पता', reply: 'हमारा पता: [अस्पताल का पता]. Google Maps: [लिंक]' },
  { words: 'emergency, इमरजेंसी', reply: 'इमरजेंसी के लिए तुरंत कॉल करें: [नंबर]. इमरजेंसी 24 घंटे खुली है।' },
];

/** Rules that run by themselves: replies outside office hours, keyword answers, who gets new leads, limits. */
export function WaAutomation({ canManage, toast }: { canManage: boolean; toast: (m: string) => void }) {
  const [data, setData] = useState<Res | null>(null);
  const [form, setForm] = useState<Automation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try { const r = await crm.get<Res>('/api/v1/whatsapp/automation'); setData(r); setForm(r.rules); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const dirty = useMemo(() => !!data && !!form && JSON.stringify(data.rules) !== JSON.stringify(form), [data, form]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data || !form) return <Skeleton h={600} />;
  const set = <K extends keyof Automation>(k: K, v: Automation[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setRule = (i: number, r: Partial<Rule>) => set('keywords', form.keywords.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const ro = !canManage;

  const save = async () => {
    setSaving(true);
    try { await crm.put('/api/v1/whatsapp/automation', form); await load(); toast('Automation saved. It applies to the next message.'); }
    catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="wau-wrap">
      {ro && <div className="ld-banner"><span>You can see these rules. A marketing manager or admin can change them.</span></div>}

      <section className="crm-card wa-step">
        <Head icon={<MessageSquareReply size={18} />} title="Instant replies" sub="Answered the moment someone writes: free, inside WhatsApp's 24-hour window." />
        <div className="wau-row">
          <div className="wa-field">
            <span className="wa-label">To a new enquiry</span>
            <span className="wau-quote">{data.autoReply || <em className="crm-sub">Off</em>}</span>
            <span className="wa-hint">Set by an admin in the <Link href="/admin/whatsapp?tab=setup">Setup</Link> tab.</span>
          </div>
          <label className="wa-field">
            <span className="wa-label">Outside office hours, send this instead</span>
            <textarea className="crm-textarea" rows={3} disabled={ro} value={form.afterHoursReply ?? ''} maxLength={1000} onChange={(e) => set('afterHoursReply', e.target.value)}
              placeholder="नमस्ते! अभी OPD बंद है। हम कल सुबह 9 बजे आपसे संपर्क करेंगे। इमरजेंसी के लिए कॉल करें: …" />
          </label>
        </div>
        <div className="wau-hours">
          <label className="wau-switch"><input type="checkbox" disabled={ro} checked={form.officeHoursOn} onChange={(e) => set('officeHoursOn', e.target.checked)} /> Use office hours</label>
          <div className="crm-chips" aria-label="Office days">
            {DAYS.map((d, i) => (
              <button key={d} type="button" className="crm-chip" disabled={ro || !form.officeHoursOn} aria-pressed={form.officeDays.includes(i)}
                onClick={() => set('officeDays', form.officeDays.includes(i) ? form.officeDays.filter((x) => x !== i) : [...form.officeDays, i].sort())}>{d}</button>
            ))}
          </div>
          <label className="wau-time"><Clock size={14} aria-hidden /> From <input type="time" className="crm-input" disabled={ro || !form.officeHoursOn} value={form.officeStart} onChange={(e) => set('officeStart', e.target.value)} /></label>
          <label className="wau-time">to <input type="time" className="crm-input" disabled={ro || !form.officeHoursOn} value={form.officeEnd} onChange={(e) => set('officeEnd', e.target.value)} /></label>
          <span className="crm-sub">India time</span>
        </div>
      </section>

      <section className="crm-card wa-step">
        <Head icon={<MessageSquareReply size={18} />} title="Keyword replies" sub="When a message contains one of these words, this reply goes out automatically (once per person every 12 hours). Good for OPD timings, address, emergency number." />
        {form.keywords.length === 0 && <span className="crm-sub">No keyword replies yet.</span>}
        <div className="wau-rules">
          {form.keywords.map((r, i) => (
            <div key={r.id} className={`wau-rule${r.on ? '' : ' is-off'}`}>
              <div className="wau-rule-head">
                <label className="wau-switch"><input type="checkbox" disabled={ro} checked={r.on} onChange={(e) => setRule(i, { on: e.target.checked })} /> On</label>
                <label className="wa-field" style={{ flex: 1 }}>
                  <span className="wa-label">Words (comma-separated)</span>
                  <input className="crm-input" disabled={ro} value={r.words.join(', ')} onChange={(e) => setRule(i, { words: e.target.value.split(',').map((w) => w.trimStart()) })} placeholder="OPD, timing, समय" />
                </label>
                {!ro && <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove this rule" onClick={() => set('keywords', form.keywords.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
              </div>
              <label className="wa-field">
                <span className="wa-label">Reply</span>
                <textarea className="crm-textarea" rows={2} disabled={ro} value={r.reply} maxLength={1000} onChange={(e) => setRule(i, { reply: e.target.value })} />
              </label>
            </div>
          ))}
        </div>
        {!ro && (
          <div className="wa-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => set('keywords', [...form.keywords, { id: Math.random().toString(36).slice(2, 10), words: [], reply: '', on: true }])}><Plus size={14} aria-hidden /> Add a keyword reply</button>
            {STARTERS.filter((s) => !form.keywords.some((k) => k.words.join(', ').toLowerCase() === s.words.toLowerCase())).map((s) => (
              <button key={s.words} type="button" className="crm-chip" onClick={() => set('keywords', [...form.keywords, { id: Math.random().toString(36).slice(2, 10), words: s.words.split(',').map((w) => w.trim()), reply: s.reply, on: true }])}>+ {s.words.split(',')[0]}</button>
            ))}
          </div>
        )}
      </section>

      <section className="crm-card wa-step">
        <Head icon={<Shuffle size={18} />} title="Who handles new leads" sub="New WhatsApp enquiries need an owner fast." />
        <div className="crm-chips">
          <button type="button" className="crm-chip" disabled={ro} aria-pressed={form.assignMode === 'none'} onClick={() => set('assignMode', 'none')}>Whoever replies first</button>
          <button type="button" className="crm-chip" disabled={ro} aria-pressed={form.assignMode === 'balance'} onClick={() => set('assignMode', 'balance')}>Share between people</button>
        </div>
        {form.assignMode === 'balance' && (
          <div className="wa-field">
            <span className="wa-label"><Users size={14} aria-hidden /> Each new lead goes to whoever of these has the fewest open leads</span>
            <div className="crm-chips">
              {data.people.map((p) => (
                <button key={p.agentId} type="button" className="crm-chip" disabled={ro} aria-pressed={form.assignTo.includes(p.agentId)}
                  onClick={() => set('assignTo', form.assignTo.includes(p.agentId) ? form.assignTo.filter((x) => x !== p.agentId) : [...form.assignTo, p.agentId])}>{p.name}</button>
              ))}
            </div>
            {form.assignTo.length === 0 && <span className="wl-err">Pick at least one person, or nobody will be assigned.</span>}
          </div>
        )}
        <div className="wau-row">
          <label className="wa-field">
            <span className="wa-label">Reply target (minutes)</span>
            <input type="number" className="crm-input" min={1} max={1440} disabled={ro} value={form.replyTargetMinutes} onChange={(e) => set('replyTargetMinutes', Number(e.target.value) || 15)} />
            <span className="wa-hint">Leads waiting longer than this turn red in the Leads inbox.</span>
          </label>
          <label className="wa-field wau-check">
            <span className="wa-label">Partners&apos; own messages</span>
            <label className="wau-switch"><input type="checkbox" disabled={ro} checked={form.partnerMessagesAreLeads} onChange={(e) => set('partnerMessagesAreLeads', e.target.checked)} /> Make a lead when a partner writes without a patient code</label>
            <span className="wa-hint">Off: they stay a conversation in the inbox (an ASHA saying “thank you” isn&apos;t a patient).</span>
          </label>
        </div>
      </section>

      <section className="crm-card wa-step">
        <Head icon={<ShieldBan size={18} />} title="Limits and opt-outs" sub="Protects the number's quality rating and the bill." />
        <div className="wau-row">
          <label className="wa-field">
            <span className="wa-label">Most template messages per day</span>
            <input type="number" className="crm-input" min={0} max={100000} disabled={ro} value={form.dailyTemplateLimit} onChange={(e) => set('dailyTemplateLimit', Math.max(0, Number(e.target.value) || 0))} />
            <span className="wa-hint">Broadcasts and follow-ups stop for the day when reached. 0 = no limit. Replies within 24 hours don&apos;t count.</span>
          </label>
          <label className="wa-field">
            <span className="wa-label">Words that mean “stop messaging me”</span>
            <input className="crm-input" disabled={ro} value={form.stopWords.join(', ')} onChange={(e) => set('stopWords', e.target.value.split(',').map((w) => w.trimStart()))} />
            <span className="wa-hint">A message that is exactly one of these opts the person out of all WhatsApp messages.</span>
          </label>
        </div>
      </section>

      {canManage && (
        <div className={`wa-savebar${dirty ? ' is-dirty' : ''}`}>
          <span>{dirty ? 'You have unsaved changes.' : 'All saved.'}</span>
          {dirty && <button type="button" className="crm-btn is-secondary" onClick={() => setForm(data.rules)} disabled={saving}>Discard</button>}
          <button type="button" className="crm-btn" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save rules'}</button>
        </div>
      )}
    </div>
  );
}

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="wa-step-head">
      <span className="wa-num" aria-hidden>{icon}</span>
      <div><h2 className="crm-h2">{title}</h2><p className="crm-sub">{sub}</p></div>
    </div>
  );
}
