'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { CONTACT_TYPES, Empty, ErrorBox, fmt, friendlyError, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

interface Doctor { id: string; name: string; department?: string | null; opdDays?: string | null; opdTimings?: string | null }
interface AudienceInfo { total: number; excluded: number; byType: { type: string; count: number }[]; blocks: string[] }
interface BroadcastRow {
  id: string; kind: string; title: string; language: string; previewText: string; recipientCount: number; scheduledAt?: string | null; status: string; error?: string | null;
  sentAt?: string | null; sentCount: number; deliveredCount: number; readCount: number; replyCount: number; failedCount: number; createdAt: string;
}

const KINDS = [
  { key: 'doctor_availability', name: 'Doctor availability', sub: 'Which doctor is in OPD, and when' },
  { key: 'schedule_change', name: 'OPD or schedule change', sub: 'Doctor on leave, new timings' },
  { key: 'camp_invite', name: 'Health camp invite', sub: 'Date, place and what is free' },
  { key: 'general_update', name: 'General update', sub: 'New service, package, news' },
];

const DEFAULT_TYPES = ['rmp_doctor', 'asha_worker', 'nursing_home', 'independent_doctor'];

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BroadcastsPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'whatsapp');
  const [toast, showToast] = useToast();

  const status = useLoader(() => crm.get<{ connected: boolean }>('/api/v1/broadcasts/status'));
  const history = useLoader(() => crm.get<BroadcastRow[]>('/api/v1/broadcasts'));
  const doctors = useLoader(() => crm.get<Doctor[]>('/api/v1/doctors'));

  const [kind, setKind] = useState('doctor_availability');
  const [params, setParams] = useState<Record<string, string>>({});
  const [doctorId, setDoctorId] = useState('');
  const [language, setLanguage] = useState<'hi' | 'en'>('hi');
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [block, setBlock] = useState('');
  const [importantOnly, setImportantOnly] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [scheduleAt, setScheduleAt] = useState(() => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); return localInput(d); });
  const [audience, setAudience] = useState<AudienceInfo | null>(null);
  const [preview, setPreview] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audienceBody = useMemo(() => ({ contactTypes: types, blocks: block ? [block] : [], importantOnly }), [types, block, importantOnly]);

  useEffect(() => {
    const t = setTimeout(() => {
      crm.post<AudienceInfo>('/api/v1/broadcasts/audience', audienceBody).then(setAudience).catch(() => setAudience(null));
    }, 250);
    return () => clearTimeout(t);
  }, [audienceBody]);

  useEffect(() => {
    const t = setTimeout(() => {
      crm.post<{ text: string }>('/api/v1/broadcasts/preview', { kind, language, params }).then((r) => setPreview(r.text)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [kind, language, params]);

  const setParam = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));
  const pickDoctor = (id: string) => {
    setDoctorId(id);
    const d = doctors.data?.find((x) => x.id === id);
    if (d) setParams((p) => ({ ...p, doctorName: d.name, department: d.department ?? '', timing: p.timing || d.opdTimings || '' }));
  };

  const countFor = (t: string) => audience?.byType.find((x) => x.type === t)?.count ?? 0;
  const missing = useMemo(() => {
    const need: Record<string, string[]> = {
      doctor_availability: ['doctorName', 'date', 'timing'],
      schedule_change: ['doctorName', 'details'],
      camp_invite: ['place', 'date'],
      general_update: ['message'],
    };
    return (need[kind] ?? []).filter((k) => !params[k]?.trim());
  }, [kind, params]);

  const submit = async () => {
    setError(null);
    if (missing.length) return setError('Fill in the highlighted details first.');
    if (!audience?.total) return setError('Nobody matches this audience.');
    setBusy('send');
    try {
      await crm.post('/api/v1/broadcasts', {
        kind, language, params, audience: audienceBody,
        scheduledAt: when === 'now' ? null : new Date(scheduleAt).toISOString(),
      });
      showToast(when === 'now' ? `Sending to ${audience.total} people…` : `Scheduled for ${fmt.dateTime(new Date(scheduleAt).toISOString())}.`);
      void history.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setError(null);
    setBusy('test');
    try {
      await crm.post('/api/v1/broadcasts/test', { kind, language, params, phone: testPhone });
      showToast('Test message sent.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (b: BroadcastRow) => {
    try { await crm.post(`/api/v1/broadcasts/${b.id}/cancel`); showToast('Broadcast cancelled.'); void history.reload(); }
    catch (e) { showToast(friendlyError(e)); }
  };

  const field = (key: string, label: string, placeholder?: string, long?: boolean) => (
    <label className="crm-field" key={key}>
      {label}
      {long ? (
        <textarea className="crm-textarea" value={params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} placeholder={placeholder}
          aria-invalid={!!error && missing.includes(key)} style={error && missing.includes(key) ? { borderColor: 'var(--bad)' } : undefined} />
      ) : (
        <input className="crm-input" value={params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} placeholder={placeholder}
          aria-invalid={!!error && missing.includes(key)} style={error && missing.includes(key) ? { borderColor: 'var(--bad)' } : undefined} />
      )}
    </label>
  );

  return (
    <main className="crm-page">
      <PageHead title="WhatsApp broadcasts" sub="Tell partners which doctor is available, OPD changes, camps and hospital news.">
        {status.data && (
          status.data.connected
            ? <Pill tone="ok" dot>Connected · hospital WhatsApp number</Pill>
            : <Pill tone="warn" dot>WhatsApp not connected yet</Pill>
        )}
      </PageHead>

      {status.data && !status.data.connected && (
        <div className="crm-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>
          Messages can be prepared and scheduled, but they will only send once the hospital&apos;s WhatsApp Business number is connected on the server
          (WhatsApp Cloud API phone number ID and access token) and each message type is approved by WhatsApp as a template.
        </div>
      )}

      {!editable ? <div className="crm-note">You can see past broadcasts. Ask an admin for edit access to send new ones.</div> : (
        <div className="crm-row">
          <section className="crm-card grow-3" aria-label="Compose" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="crm-h2" style={{ paddingBottom: 12 }}>1 · What do you want to tell them?</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                {KINDS.map((k) => {
                  const on = kind === k.key;
                  return (
                    <button key={k.key} type="button" aria-pressed={on} onClick={() => { setKind(k.key); setError(null); }}
                      style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, cursor: 'pointer',
                        border: on ? '2px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-tint)' : '#fff', color: 'var(--text)' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{on && <Check size={15} color="var(--accent)" aria-hidden />}{k.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{k.sub}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="crm-form-grid">
              {(kind === 'doctor_availability' || kind === 'schedule_change') && (
                <label className="crm-field">Doctor
                  <select className="crm-select" value={doctorId} onChange={(e) => pickDoctor(e.target.value)}>
                    <option value="">{doctors.data?.length ? 'Pick a doctor…' : 'No doctors added yet — type below'}</option>
                    {doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}{d.department ? ` · ${d.department}` : ''}</option>)}
                  </select>
                </label>
              )}
              {(kind === 'doctor_availability' || kind === 'schedule_change') && field('doctorName', 'Doctor name as it should appear', 'e.g. Dr. A. Kumar')}
              {(kind === 'doctor_availability' || kind === 'schedule_change') && field('department', 'Department', 'e.g. Obstetrics & Gynaecology')}
              {kind === 'doctor_availability' && field('date', 'Date', 'e.g. Fri, 30 Oct')}
              {kind === 'doctor_availability' && field('timing', 'OPD timing', 'e.g. 10 am – 2 pm')}
              {kind === 'camp_invite' && field('place', 'Place', 'e.g. Bahadurganj panchayat bhawan')}
              {kind === 'camp_invite' && field('date', 'Date', 'e.g. Sun, 8 Nov, 9 am')}
            </div>
            {kind === 'doctor_availability' && field('note', 'Extra line (optional)', 'e.g. Free consultation for referred patients')}
            {kind === 'schedule_change' && field('details', 'What changed', 'e.g. OPD moves to Tuesday and Thursday from next week', true)}
            {kind === 'camp_invite' && field('details', "What's offered (optional)", 'e.g. Free BP, sugar and eye check-up', true)}
            {kind === 'general_update' && field('message', 'Message', 'e.g. 24 × 7 emergency and ambulance now available', true)}

            <div role="group" aria-label="Language" className="crm-chips" style={{ alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>Language</span>
              <button type="button" className="crm-chip" aria-pressed={language === 'hi'} onClick={() => setLanguage('hi')} style={{ fontFamily: "'Noto Sans Devanagari', Inter, sans-serif" }}>हिन्दी</button>
              <button type="button" className="crm-chip" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
            </div>

            <fieldset style={{ border: 0, borderTop: '1px solid var(--line)', margin: 0, padding: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <legend className="crm-h2" style={{ float: 'left', width: '100%', paddingBottom: 12 }}>2 · Who receives it</legend>
              <div className="crm-chips">
                {CONTACT_TYPES.map((t) => {
                  const on = types.includes(t.value);
                  return (
                    <button key={t.value} type="button" className="crm-chip is-soft" aria-pressed={on}
                      onClick={() => setTypes((x) => (on ? x.filter((y) => y !== t.value) : [...x, t.value]))}>
                      {on && <Check size={14} aria-hidden />}{t.label}<span style={{ fontWeight: 500, color: 'var(--text-2)' }}>{countFor(t.value)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="crm-form-grid">
                <label className="crm-field">Block
                  <select className="crm-select" value={block} onChange={(e) => setBlock(e.target.value)}>
                    <option value="">All blocks</option>
                    {audience?.blocks.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </label>
                <label className="crm-field" style={{ justifyContent: 'flex-end' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, height: 46 }}>
                    <input type="checkbox" checked={importantOnly} onChange={(e) => setImportantOnly(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
                    Only important partners
                  </span>
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, background: 'var(--accent-soft)', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 26, fontWeight: 800, color: 'var(--accent-ink)' }}>{audience?.total ?? '…'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>people will receive this</span>
                  {!!audience?.excluded && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{audience.excluded} left out: no valid number or they replied STOP</span>}
                </span>
              </div>
            </fieldset>

            <fieldset style={{ border: 0, borderTop: '1px solid var(--line)', margin: 0, padding: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <legend className="crm-h2" style={{ float: 'left', width: '100%', paddingBottom: 12 }}>3 · When</legend>
              <div className="crm-chips" style={{ alignItems: 'center' }}>
                <button type="button" className="crm-chip is-soft" aria-pressed={when === 'now'} onClick={() => setWhen('now')}>Send now</button>
                <button type="button" className="crm-chip is-soft" aria-pressed={when === 'later'} onClick={() => setWhen('later')}>Schedule</button>
                {when === 'later' && <input type="datetime-local" className="crm-input" style={{ width: 'auto', height: 40 }} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} aria-label="Send at" />}
              </div>
            </fieldset>

            {error && <div className="crm-error" role="alert">{error}</div>}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="crm-field" style={{ flex: '1 1 200px' }}>Send a test to
                <input className="crm-input" inputMode="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Your mobile number" />
              </label>
              <button type="button" className="crm-btn is-secondary" disabled={!testPhone.trim() || !!busy} onClick={sendTest}>{busy === 'test' ? 'Sending…' : 'Send test'}</button>
              <button type="button" className="crm-btn is-lg" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={submit}>
                <Send size={18} aria-hidden />
                {busy === 'send' ? 'Saving…' : when === 'now' ? `Send to ${audience?.total ?? 0} people` : `Schedule for ${audience?.total ?? 0} people`}
              </button>
            </div>
          </section>

          <aside className="grow-1" aria-label="Preview" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 className="crm-h2">What they will see</h2>
              <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{ background: 'var(--ink)', color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 999, background: '#fff', color: 'var(--ink)', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>GA</span>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Glisan Akbari Hospital</span>
                    <span style={{ fontSize: 11, color: '#aeb7ca' }}>Business account</span>
                  </span>
                </div>
                <div style={{ background: '#efeae2', padding: '18px 14px' }}>
                  <div style={{ maxWidth: '92%', background: '#fff', borderRadius: '4px 14px 14px 14px', padding: '12px 14px', boxShadow: '0 1px 1px rgba(0,0,0,0.08)', whiteSpace: 'pre-line',
                    fontFamily: "'Noto Sans Devanagari', Inter, sans-serif", fontSize: 14, lineHeight: 1.6 }}>
                    {preview || '…'}
                  </div>
                </div>
              </div>
              <p className="crm-sub" style={{ fontSize: 12, lineHeight: 1.5 }}>
                [Name] is replaced with each person&apos;s name. Anyone who replies STOP is removed automatically, and replies show in the live activity feed.
              </p>
            </div>
          </aside>
        </div>
      )}

      <section className="crm-card is-flush" aria-labelledby="hist-h">
        <div className="crm-card-head"><h2 id="hist-h" className="crm-h2">Recent broadcasts</h2></div>
        {history.error && <div style={{ padding: '0 22px' }}><ErrorBox message={history.error} onRetry={history.reload} /></div>}
        {!history.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={120} /></div> : history.data.length === 0 ? <Empty title="No broadcasts yet" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 760 }}>
              <thead><tr><th>Message</th><th className="num">Sent to</th><th className="num">Delivered</th><th className="num">Read</th><th className="num">Replies</th><th>Status</th></tr></thead>
              <tbody>
                {history.data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="crm-cell-main">{b.title}</div>
                      <div className="crm-cell-sub">{fmt.dateTime(b.sentAt ?? b.scheduledAt ?? b.createdAt)} · {b.language === 'en' ? 'English' : 'Hindi'}</div>
                    </td>
                    <td className="num">{b.status === 'sent' ? b.sentCount : b.recipientCount}</td>
                    <td className="num">{b.status === 'sent' ? b.deliveredCount : '–'}</td>
                    <td className="num">{b.status === 'sent' ? b.readCount : '–'}</td>
                    <td className="num">{b.status === 'sent' ? b.replyCount : '–'}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                        <Pill tone={b.status === 'sent' ? 'ok' : b.status === 'scheduled' ? 'accent' : b.status === 'failed' ? 'bad' : b.status === 'sending' ? 'info' : 'neutral'}>
                          {b.status === 'scheduled' ? 'Scheduled' : b.status === 'sent' ? 'Sent' : b.status === 'failed' ? 'Failed' : b.status === 'sending' ? 'Sending…' : 'Cancelled'}
                        </Pill>
                        {b.status === 'scheduled' && editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => cancel(b)}>Cancel</button>}
                      </span>
                      {b.error && <div className="crm-cell-sub" style={{ color: 'var(--bad)' }}>{b.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {toast}
    </main>
  );
}
