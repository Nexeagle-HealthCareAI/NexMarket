'use client';

import { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';

export interface WaButton { type: string; text: string; url?: string | null; phone?: string | null }
export interface WaTemplate {
  id?: string | null; name: string; language: string; status: string; category: string; reason?: string | null;
  header?: string | null; headerFormat?: string | null; body: string; footer?: string | null; buttons: WaButton[];
  params: number; examples: string[]; usedFor: string[];
}
export interface WaStatus {
  connected: boolean; displayPhone?: string | null; hospital: string; paused: boolean; pausedBy?: string | null; pausedAt?: string | null;
  templatesToday: number; dailyLimit: number; unread: number; canManage: boolean; isAdmin: boolean; me: string;
  /** Only for people who manage WhatsApp, and only when a monthly budget is set. */
  billing?: { budget: number; spent: number; currency?: string | null; alertPercent: number; stopAtBudget: boolean; at?: string | null } | null;
}

export const istTime = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istDayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
export const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export function when(iso: string) {
  return istDay(iso) === istDay(new Date().toISOString()) ? istTime.format(new Date(iso)) : istDayFmt.format(new Date(iso));
}
export function dayLabel(iso: string) {
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? 'Today' : d === y ? 'Yesterday' : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
export const showPhone = (p: string) => (p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p);

/** The template's text with the blanks filled in (blank ones shown as [1], [2]…). */
export function fill(body: string, values: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => values[Number(n) - 1]?.trim() || `[${n}]`);
}

export const SOURCE_LABEL: Record<string, string> = {
  in: 'Received', inbox: 'Inbox reply', lead: 'Leads inbox', auto: 'Instant reply', followup: 'Follow-up', broadcast: 'Broadcast', test: 'Test', resend: 'Sent again',
};
export const sourceLabel = (s: string) => (s.startsWith('rule:') ? 'Keyword reply' : SOURCE_LABEL[s] ?? s);

/** How a template looks on the phone. */
export function TemplateBubble({ t, values }: { t: Pick<WaTemplate, 'header' | 'body' | 'footer' | 'buttons'>; values?: string[] }) {
  return (
    <div className="wt-bubble">
      {t.header && <strong className="wt-bubble-head">{t.header}</strong>}
      <span className="wt-bubble-body">{values ? fill(t.body, values) : t.body}</span>
      {t.footer && <span className="wt-bubble-foot">{t.footer}</span>}
      {t.buttons.length > 0 && (
        <span className="wt-bubble-btns">{t.buttons.map((b, i) => <span key={i}>{b.type === 'URL' ? '↗ ' : b.type === 'PHONE_NUMBER' ? '☎ ' : '↩ '}{b.text}</span>)}</span>
      )}
    </div>
  );
}

/** Pick an approved template and fill in its blanks, then send. Used when the 24-hour window is closed, or to start a chat. */
export function TemplateSender({ title, onClose, onSend, askPhone, defaultName }: {
  title: string; onClose: () => void; askPhone?: boolean; defaultName?: string;
  onSend: (body: { template: string; language: string; values: string[]; preview: string; phone?: string; name?: string }) => Promise<void>;
}) {
  const [list, setList] = useState<WaTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    crm.get<{ items: WaTemplate[] }>('/api/v1/whatsapp/templates')
      .then((r) => { if (alive) setList(r.items.filter((t) => t.status === 'APPROVED')); })
      .catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  const t = useMemo(() => list?.find((x) => `${x.name}|${x.language}` === pick) ?? null, [list, pick]);
  const choose = (key: string) => {
    setPick(key);
    const x = list?.find((y) => `${y.name}|${y.language}` === key);
    setValues(Array.from({ length: x?.params ?? 0 }, (_, i) => (i === 0 && defaultName ? defaultName : '')));
  };
  const digits = phone.replace(/\D/g, '');
  const ok = !!t && values.every((v) => v.trim()) && (!askPhone || digits.length === 10 || (digits.length === 12 && digits.startsWith('91')));
  const send = async () => {
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ template: t.name, language: t.language, values, preview: [t.header, fill(t.body, values)].filter(Boolean).join('\n'), phone: askPhone ? digits : undefined, name: askPhone ? name.trim() || undefined : undefined });
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={!ok || busy} onClick={() => void send()}><Send size={16} aria-hidden /> {busy ? 'Sending…' : 'Send'}</button>
      </>}>
      {askPhone && (
        <div className="ld-form">
          <label className="crm-field">Mobile number
            <input className="crm-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10 digits" autoFocus />
          </label>
          <label className="crm-field">Name (optional)
            <input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
        </div>
      )}
      {!list && !error ? <Skeleton h={120} /> : (
        <label className="crm-field">Approved template
          <select className="crm-select" value={pick} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose…</option>
            {(list ?? []).map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>{x.name} · {x.language} · {x.category.toLowerCase()}</option>)}
          </select>
        </label>
      )}
      {list && list.length === 0 && <span className="crm-sub">No approved templates yet. Create one in WhatsApp → Templates.</span>}
      {t && (
        <div className="wt-send">
          <div className="wt-send-fields">
            {values.map((v, i) => (
              <label key={i} className="crm-field">Blank {`{{${i + 1}}}`}{t.examples[i] ? <span className="crm-sub" style={{ fontWeight: 400 }}> e.g. {t.examples[i]}</span> : null}
                <input className="crm-input" value={v} maxLength={500} onChange={(e) => setValues((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              </label>
            ))}
            {values.length === 0 && <span className="crm-sub">This template has no blanks to fill.</span>}
          </div>
          <div className="wt-send-preview"><span className="crm-sub">Preview</span><TemplateBubble t={t} values={values} /></div>
        </div>
      )}
      {t?.category === 'MARKETING' && <span className="crm-sub" style={{ fontSize: 12 }}>Marketing templates are charged by Meta per message.</span>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
