'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Check, CreditCard, FileText, Film, Gift, HeartHandshake, ImagePlus, LayoutTemplate, Megaphone, MessageCircle, Send, Stethoscope, Tent, UserPlus, Users,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, orgName, useAccess, hasOpd } from '@/lib/crm/access';
import { CONTACT_TYPES, Empty, ErrorBox, fmt, friendlyError, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';
import { Pager, usePaged } from '@/components/crm/Pager';
import type { WaTemplate } from './shared';
import { PlacePicker, type Place, type Places } from './PlacePicker';
import { FEATURES } from '@/lib/crm/features';

interface Doctor { id: string; name: string; department?: string | null; opdDays?: string | null; opdTimings?: string | null }
interface AudienceInfo {
  total: number; byGroup: Record<string, number>; byType: { type: string; count: number }[];
  campNoConsent: number; optedOut: number; noPlace: number; duplicates: number;
}
interface CampRow { id: string; title: string; date: string; venue?: string | null; block?: string | null; people: number }
interface BroadcastRow {
  id: string; kind: string; title: string; language: string; previewText: string; recipientCount: number; scheduledAt?: string | null; status: string; error?: string | null;
  sentAt?: string | null; sentCount: number; deliveredCount: number; readCount: number; replyCount: number; failedCount: number; createdAt: string; audience?: string;
}
interface Media { mediaId: string; type: 'image' | 'document' | 'video'; fileName: string; url: string | null }

const GROUPS = [
  { key: 'partners', name: 'Partners', sub: 'RMPs, ASHAs, chemists, mukhiyas…', icon: HeartHandshake },
  { key: 'camp', name: 'Health camp people', sub: 'Booked at a camp, by agents or QR', icon: Tent },
  { key: 'referred', name: 'Referred patients', sub: 'Patients partners sent to you', icon: UserPlus },
  ...(FEATURES.healthCards ? [{ key: 'cards', name: 'Health card holders', sub: 'Everyone with a card', icon: CreditCard }] : []),
  { key: 'enquiries', name: 'Enquiries', sub: 'Wrote on WhatsApp, forms, website', icon: MessageCircle },
] as const;

const KINDS = [
  { key: 'wishes', name: 'Wishes & greetings', sub: 'Festivals, health days, a thank-you', icon: Gift },
  { key: 'template', name: 'Any approved template', sub: 'Your own, with a picture or PDF', icon: LayoutTemplate },
  { key: 'doctor_availability', name: 'Doctor availability', sub: hasOpd() ? 'Which doctor is in OPD, and when' : 'Which doctor is in, and when', icon: Stethoscope },
  { key: 'schedule_change', name: hasOpd() ? 'OPD or schedule change' : 'Schedule change', sub: 'Doctor on leave, new timings', icon: CalendarDays },
  { key: 'camp_invite', name: 'Health camp invite', sub: 'Date, place and what is free', icon: Tent },
  { key: 'general_update', name: 'General update', sub: 'New service, package, news', icon: Megaphone },
];

/** Ready-made lines for the wishes message. */
const WISHES = [
  'दीपावली की हार्दिक शुभकामनाएँ! 🪔', 'छठ महापर्व की हार्दिक शुभकामनाएँ! ☀️', 'ईद मुबारक! 🌙', 'होली की हार्दिक शुभकामनाएँ! 🎨',
  'नव वर्ष 2027 की हार्दिक शुभकामनाएँ! 🎉', 'गणतंत्र दिवस की हार्दिक शुभकामनाएँ! 🇮🇳', 'स्वतंत्रता दिवस की हार्दिक शुभकामनाएँ! 🇮🇳',
  'विश्व स्वास्थ्य दिवस पर: रोज़ 30 मिनट टहलें, पानी ज़्यादा पिएँ। 💚', 'हमारे साथ जुड़े रहने के लिए दिल से धन्यवाद। 🙏',
];

const DEFAULT_TYPES = ['rmp_doctor', 'asha_worker', 'nursing_home', 'independent_doctor'];
const NAME = '{name}';
const WISH_TEMPLATE = 'nx_wishes';

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const blanksOf = (body: string) => new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;

/** Blank 1 after "नमस्ते", "प्रिय", "Hello"… is the person's name. */
function startValues(t: WaTemplate): string[] {
  return Array.from({ length: blanksOf(t.body) }, (_, i) => {
    if (i === 0 && /(नमस्ते|नमस्कार|प्रिय|आदरणीय|hello|dear|hi)\s*\{\{\s*1\s*\}\}/i.test(t.body)) return (t.examples[0] ?? '').trim().endsWith('जी') ? `${NAME} जी` : NAME;
    return '';
  });
}

const mediaKind = (f?: string | null) => (f === 'IMAGE' ? 'image' : f === 'DOCUMENT' ? 'document' : f === 'VIDEO' ? 'video' : null);

/** WhatsApp broadcasts, as a tab of the WhatsApp page. */
export function WaBroadcasts() {
  const { access } = useAccess();
  const editable = canEdit(access, 'whatsapp');
  const [toast, showToast] = useToast();

  const history = useLoader(() => crm.get<BroadcastRow[]>('/api/v1/broadcasts'));
  const histPg = usePaged(history.data ?? [], '', 25);
  const doctors = useLoader(() => crm.get<Doctor[]>('/api/v1/doctors'));
  const placesL = useLoader(() => crm.get<Place[]>('/api/v1/broadcasts/places'));
  const campsL = useLoader(() => crm.get<CampRow[]>('/api/v1/broadcasts/camps'));
  const tplL = useLoader(() => crm.get<{ items: WaTemplate[] }>('/api/v1/whatsapp/templates'));

  // Who
  const [groups, setGroups] = useState<string[]>(['partners']);
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [importantOnly, setImportantOnly] = useState(false);
  const [places, setPlaces] = useState<Places>({ districts: [], blocks: [], panchayats: [] });
  const [campIds, setCampIds] = useState<string[]>([]);
  const [arrivedOnly, setArrivedOnly] = useState(false);
  const [noConsent, setNoConsent] = useState(false);
  const [audience, setAudience] = useState<AudienceInfo | null>(null);

  // What
  const [kind, setKind] = useState('wishes');
  const [params, setParams] = useState<Record<string, string>>({});
  const [doctorId, setDoctorId] = useState('');
  const [language, setLanguage] = useState<'hi' | 'en'>('hi');
  const [tplKey, setTplKey] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [media, setMedia] = useState<Media | null>(null);
  const [uploading, setUploading] = useState(false);
  const [readyPreview, setReadyPreview] = useState('');
  const [linkCamp, setLinkCamp] = useState('');
  const [todayIso] = useState(() => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));

  // When
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [scheduleAt, setScheduleAt] = useState(() => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); return localInput(d); });
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const audienceBody = useMemo(() => ({
    groups, contactTypes: types, importantOnly, districts: places.districts, blocks: places.blocks, panchayats: places.panchayats,
    campIds, campArrivedOnly: arrivedOnly, includeNoConsent: noConsent,
  }), [groups, types, importantOnly, places, campIds, arrivedOnly, noConsent]);

  useEffect(() => {
    const t = setTimeout(() => {
      crm.post<AudienceInfo>('/api/v1/broadcasts/audience', audienceBody).then(setAudience).catch(() => setAudience(null));
    }, 300);
    return () => clearTimeout(t);
  }, [audienceBody]);

  const ready = !['template', 'wishes'].includes(kind);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      crm.post<{ text: string }>('/api/v1/broadcasts/preview', { kind, language, params }).then((r) => setReadyPreview(r.text)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [ready, kind, language, params]);
  useEffect(() => () => { if (media?.url) URL.revokeObjectURL(media.url); }, [media]);

  // Templates that can go to many people: approved, with blanks only in the message.
  const approved = useMemo(() => (tplL.data?.items ?? []).filter((t) => t.status === 'APPROVED' && (!t.headerFormat || t.headerFormat === 'TEXT' ? !/\{\{/.test(t.header ?? '') : true)), [tplL.data]);
  const wishTpl = approved.find((t) => t.name === WISH_TEMPLATE);
  const tpl = kind === 'wishes' ? wishTpl : approved.find((t) => `${t.name}|${t.language}` === tplKey);
  const needMedia = mediaKind(tpl?.headerFormat);

  const chooseTemplate = (t: WaTemplate | undefined) => {
    setTplKey(t ? `${t.name}|${t.language}` : '');
    setValues(t ? startValues(t) : []);
    setMedia(null);
    setError(null);
  };
  const chooseKind = (k: string) => {
    setKind(k); setError(null);
    if (k === 'wishes') { setValues(wishTpl ? startValues(wishTpl) : []); setMedia(null); }
    if (k === 'template') chooseTemplate(undefined);
  };
  // The wishes template arrives after the page opens: fill its blanks once.
  useEffect(() => {
    if (kind === 'wishes' && wishTpl && values.length === 0) setValues(startValues(wishTpl)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [kind, wishTpl, values.length]);

  const setParam = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));
  const setValue = (i: number, v: string) => setValues((x) => x.map((y, j) => (j === i ? v : y)));
  const pickDoctor = (id: string) => {
    setDoctorId(id);
    const d = doctors.data?.find((x) => x.id === id);
    if (d) setParams((p) => ({ ...p, doctorName: d.name, department: d.department ?? '', timing: p.timing || d.opdTimings || '' }));
  };

  const missing = useMemo(() => {
    const need: Record<string, string[]> = {
      doctor_availability: ['doctorName', 'date', 'timing'], schedule_change: ['doctorName', 'details'], camp_invite: ['place', 'date'], general_update: ['message'],
    };
    return (need[kind] ?? []).filter((k) => !params[k]?.trim());
  }, [kind, params]);

  /** What's sent: a ready message's details, or the template, its blanks and attachment. */
  const sendParams = (): Record<string, string> | null => {
    const camp: Record<string, string> = linkCamp && canLinkCamp ? { campId: linkCamp } : {};
    if (ready) return { ...params, ...camp };
    if (!tpl) return null;
    const p: Record<string, string> = { template: tpl.name, templateLanguage: tpl.language, body: tpl.body, values: JSON.stringify(values.map((v) => v.trim())) };
    if (media) { p.headerType = media.type; p.headerMediaId = media.mediaId; p.headerFile = media.fileName; }
    return { ...p, ...camp };
  };
  const sendKind = ready ? kind : 'template';
  const canLinkCamp = kind === 'camp_invite' || kind === 'template' || kind === 'general_update';
  const upcoming = (campsL.data ?? []).filter((c) => c.date >= todayIso);

  const problem = (): string | null => {
    if (ready) return missing.length ? 'Fill in the highlighted details first.' : null;
    if (kind === 'wishes' && !wishTpl) return 'The wishes template isn\'t approved yet. Install the NexEagle templates (Templates tab) and wait for approval.';
    if (!tpl) return 'Pick a template.';
    if (values.some((v) => !v.trim())) return 'Fill in every blank.';
    if (values.some((v) => /\n|\t| {5,}/.test(v))) return 'WhatsApp doesn\'t allow new lines or long spaces inside a blank.';
    if (needMedia && !media) return `Add the ${needMedia === 'image' ? 'picture' : needMedia === 'document' ? 'PDF' : 'video'} for the top of the message.`;
    return null;
  };

  const submit = async () => {
    setError(null);
    const p = problem();
    if (p) return setError(p);
    if (!groups.length) return setError('Choose who to send it to.');
    if (!audience?.total) return setError('Nobody matches this audience.');
    setBusy('send');
    try {
      await crm.post('/api/v1/broadcasts', {
        kind: sendKind, language, params: sendParams(), audience: audienceBody,
        scheduledAt: when === 'now' ? null : new Date(scheduleAt).toISOString(),
        title: kind === 'wishes' ? (values[1] ?? '').slice(0, 60) : undefined,
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
    const p = problem();
    if (p) return setError(p);
    setBusy('test');
    try {
      await crm.post('/api/v1/broadcasts/test', { kind: sendKind, language, params: sendParams(), phone: testPhone });
      showToast('Test message sent.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      const r = await crm.upload<{ mediaId: string; type: Media['type']; fileName: string }>('/api/v1/broadcasts/media', fd);
      if (needMedia && r.type !== needMedia) { setError(`This template needs ${needMedia === 'image' ? 'a picture' : needMedia === 'document' ? 'a PDF' : 'a video'}.`); return; }
      setMedia({ ...r, url: r.type === 'image' ? URL.createObjectURL(f) : null });
    } catch (x) { setError(friendlyError(x)); }
    finally { setUploading(false); }
  };

  const cancel = async (b: BroadcastRow) => {
    try { await crm.post(`/api/v1/broadcasts/${b.id}/cancel`); showToast('Broadcast cancelled.'); void history.reload(); }
    catch (e) { showToast(friendlyError(e)); }
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const countFor = (t: string) => audience?.byType.find((x) => x.type === t)?.count ?? 0;

  const field = (key: string, label: string, placeholder?: string, long?: boolean) => {
    const bad = !!error && missing.includes(key);
    return (
      <label className="crm-field" key={key}>
        {label}
        {long ? <textarea className="crm-textarea" value={params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} placeholder={placeholder} aria-invalid={bad} style={bad ? { borderColor: 'var(--bad)' } : undefined} />
          : <input className="crm-input" value={params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)} placeholder={placeholder} aria-invalid={bad} style={bad ? { borderColor: 'var(--bad)' } : undefined} />}
      </label>
    );
  };

  // The preview: the template's text with the blanks filled, or the ready message.
  const shown = (v: string) => v.replaceAll(NAME, 'Reena');
  const bodyPreview = ready ? readyPreview
    : tpl ? tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => (values[Number(n) - 1]?.trim() ? shown(values[Number(n) - 1]) : `[${n}]`)) : '';

  return (
    <div className="wb-wrap">
      {!editable ? <div className="crm-note">You can see past broadcasts. Ask an admin for edit access to send new ones.</div> : (
        <div className="crm-row">
          <section className="crm-card grow-3 wb-compose" aria-label="Compose">
            {/* 1 · Who */}
            <fieldset className="wb-step">
              <legend className="crm-h2">1 · Who receives it</legend>
              <div className="wb-cards">
                {GROUPS.map((g) => {
                  const on = groups.includes(g.key);
                  const Icon = g.icon;
                  return (
                    <button key={g.key} type="button" className="wb-card" aria-pressed={on} onClick={() => setGroups((x) => toggle(x, g.key))}>
                      <span className="wb-card-top"><Icon size={18} aria-hidden />{on && <Check size={16} className="wb-tick" aria-hidden />}</span>
                      <strong>{g.name}</strong>
                      <span>{g.sub}</span>
                      <em>{on ? `${audience?.byGroup[g.key] ?? 0} people` : 'Tap to add'}</em>
                    </button>
                  );
                })}
              </div>

              {groups.includes('partners') && (
                <div className="wb-sub">
                  <span className="wb-sub-h">Partner types</span>
                  <div className="crm-chips">
                    {CONTACT_TYPES.map((t) => (
                      <button key={t.value} type="button" className="crm-chip is-soft" aria-pressed={types.includes(t.value)} onClick={() => setTypes((x) => toggle(x, t.value))}>
                        {types.includes(t.value) && <Check size={14} aria-hidden />}{t.label}<span className="wb-n">{countFor(t.value)}</span>
                      </button>
                    ))}
                  </div>
                  <label className="wb-check"><input type="checkbox" checked={importantOnly} onChange={(e) => setImportantOnly(e.target.checked)} /> Only important partners</label>
                </div>
              )}

              {groups.includes('camp') && (
                <div className="wb-sub">
                  <span className="wb-sub-h">Which camps</span>
                  <div className="crm-chips">
                    <button type="button" className="crm-chip is-soft" aria-pressed={campIds.length === 0} onClick={() => setCampIds([])}>All camps</button>
                    {(campsL.data ?? []).filter((c) => c.people > 0).slice(0, 24).map((c) => (
                      <button key={c.id} type="button" className="crm-chip is-soft" aria-pressed={campIds.includes(c.id)} onClick={() => setCampIds((x) => toggle(x, c.id))}>
                        {campIds.includes(c.id) && <Check size={14} aria-hidden />}{c.title}<span className="wb-n">{fmt.date(c.date)} · {c.people}</span>
                      </button>
                    ))}
                  </div>
                  <label className="wb-check"><input type="checkbox" checked={arrivedOnly} onChange={(e) => setArrivedOnly(e.target.checked)} /> Only people who came to the camp</label>
                  {(noConsent || !!audience?.campNoConsent) && (
                    <label className="wb-check"><input type="checkbox" checked={noConsent} onChange={(e) => setNoConsent(e.target.checked)} />
                      Also people who didn&apos;t tick “send me messages”{audience?.campNoConsent ? ` (${audience.campNoConsent})` : ''}</label>
                  )}
                </div>
              )}

              <div className="wb-sub">
                <span className="wb-sub-h">Where</span>
                {placesL.error ? <ErrorBox message={placesL.error} onRetry={placesL.reload} /> : !placesL.data ? <Skeleton h={80} />
                  : <PlacePicker places={placesL.data} value={places} onChange={setPlaces} />}
              </div>

              <div className="wb-total">
                <span className="wb-total-n">{groups.length ? audience?.total ?? '…' : 0}</span>
                <span className="wb-total-t">
                  <strong>people will receive this</strong>
                  <span>
                    {[
                      audience?.duplicates ? `${audience.duplicates} in two lists get it once` : '',
                      audience?.optedOut ? `${audience.optedOut} said STOP` : '',
                      audience?.noPlace ? `${audience.noPlace} enquiries with no known place left out` : '',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            </fieldset>

            {/* 2 · What */}
            <fieldset className="wb-step">
              <legend className="crm-h2">2 · What do you want to send?</legend>
              <div className="wb-cards is-kinds">
                {KINDS.map((k) => {
                  const on = kind === k.key;
                  const Icon = k.icon;
                  return (
                    <button key={k.key} type="button" className="wb-card" aria-pressed={on} onClick={() => chooseKind(k.key)}>
                      <span className="wb-card-top"><Icon size={18} aria-hidden />{on && <Check size={16} className="wb-tick" aria-hidden />}</span>
                      <strong>{k.name}</strong>
                      <span>{k.sub}</span>
                    </button>
                  );
                })}
              </div>

              {ready && (
                <>
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
                    {kind === 'doctor_availability' && field('timing', hasOpd() ? 'OPD timing' : 'Timing', 'e.g. 10 am – 2 pm')}
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
                </>
              )}

              {kind === 'wishes' && !wishTpl && (
                <div className="crm-note">{tplL.data ? <>The wishes template <code>{WISH_TEMPLATE}</code> isn&apos;t approved yet. Open the <strong>Templates</strong> tab → NexEagle templates → Install, then wait for Meta&apos;s approval (usually under an hour).</> : 'Loading templates…'}</div>
              )}

              {kind === 'template' && (
                <div className="wb-sub">
                  <span className="wb-sub-h">Pick a template <span className="wb-hint">Only Meta-approved ones can be sent. Make new ones, with a picture or PDF on top, in the Templates tab.</span></span>
                  {tplL.error ? <ErrorBox message={tplL.error} onRetry={tplL.reload} /> : !tplL.data ? <Skeleton h={120} /> : approved.length === 0 ? <div className="crm-note">No approved templates yet.</div> : (
                    <div className="wb-tpls">
                      {approved.map((t) => {
                        const key = `${t.name}|${t.language}`;
                        const mk = mediaKind(t.headerFormat);
                        return (
                          <button key={key} type="button" className="wb-tpl" aria-pressed={tplKey === key} onClick={() => chooseTemplate(t)}>
                            <span className="wb-tpl-head">
                              <strong>{t.name}</strong>
                              <span>{t.language} · {t.category.toLowerCase()}{mk ? ` · ${mk === 'document' ? 'PDF' : mk}` : ''}</span>
                            </span>
                            {mk && <span className="wb-tpl-media">{mk === 'image' ? <ImagePlus size={20} aria-hidden /> : mk === 'video' ? <Film size={20} aria-hidden /> : <FileText size={20} aria-hidden />}</span>}
                            <span className="wb-tpl-body">{t.body}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!ready && tpl && (
                <div className="wb-sub">
                  {needMedia && (
                    <div className="wb-media">
                      <input ref={fileRef} type="file" hidden onChange={(e) => void upload(e)}
                        accept={needMedia === 'image' ? 'image/jpeg,image/png' : needMedia === 'document' ? 'application/pdf' : 'video/mp4'} />
                      {media ? (
                        <div className="wb-media-has">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a picture just picked */}
                          {media.url ? <img src={media.url} alt="" /> : <span className="wb-doc">{media.type === 'video' ? <Film size={20} aria-hidden /> : <FileText size={20} aria-hidden />}</span>}
                          <span><strong>{media.fileName}</strong><small>On WhatsApp for 30 days</small></span>
                          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>Change</button>
                        </div>
                      ) : (
                        <button type="button" className="wb-drop" onClick={() => fileRef.current?.click()} disabled={uploading}>
                          {needMedia === 'image' ? <ImagePlus size={22} aria-hidden /> : <FileText size={22} aria-hidden />}
                          <strong>{uploading ? 'Uploading…' : needMedia === 'image' ? 'Add the picture (poster, banner)' : needMedia === 'document' ? 'Add the PDF' : 'Add the video'}</strong>
                          <span>{needMedia === 'image' ? 'JPG or PNG, under 5 MB. Wide pictures (1.9 : 1) look best.' : 'Under 16 MB.'}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {values.map((v, i) => {
                    const isName = v.includes(NAME);
                    const isWish = kind === 'wishes' && i === 1;
                    return (
                      <div key={i} className="crm-field">
                        <span className="wb-blank-h">
                          {isWish ? 'Your message' : <>Blank {`{{${i + 1}}}`}</>}
                          {tpl.examples[i] && !isWish && <small>e.g. {tpl.examples[i]}</small>}
                          {!isWish && (
                            <button type="button" className={`wb-name${isName ? ' is-on' : ''}`} onClick={() => setValue(i, isName ? '' : NAME)}>
                              <Users size={13} aria-hidden /> {isName ? 'Each person’s name' : 'Use their name'}
                            </button>
                          )}
                        </span>
                        {isName ? <span className="wb-name-shown">{v.replace(NAME, '« name »')} <small>e.g. {shown(v)}</small></span> : (
                          <input className="crm-input" value={v} onChange={(e) => setValue(i, e.target.value)} maxLength={1000}
                            placeholder={tpl.examples[i] ?? ''} aria-invalid={!!error && !v.trim()} style={error && !v.trim() ? { borderColor: 'var(--bad)' } : undefined} />
                        )}
                        {isWish && (
                          <div className="crm-chips wb-ideas">
                            {WISHES.map((w) => <button key={w} type="button" className="crm-chip is-soft" aria-pressed={v === w} onClick={() => setValue(i, w)}>{w}</button>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {canLinkCamp && (
              <div className="wb-sub wb-camp-link">
                <span className="wb-sub-h"><Tent size={15} aria-hidden /> Bookings from replies <span className="wb-hint">optional</span></span>
                <select className="crm-select" value={linkCamp} onChange={(e) => setLinkCamp(e.target.value)} aria-label="Health camp to book replies into">
                  <option value="">Not linked to a camp</option>
                  {upcoming.map((c) => <option key={c.id} value={c.id}>{c.title} · {fmt.date(c.date)}{c.block ? ` · ${c.block}` : ''}</option>)}
                </select>
                {linkCamp && <span className="wb-hint">When someone replies “book”, “नाम लिखवाएँ” or taps a booking button, they are booked into this camp and get their token number in the chat straight away. They appear on the camp page as “WhatsApp”.</span>}
              </div>
            )}

            {/* 3 · When */}
            <fieldset className="wb-step">
              <legend className="crm-h2">3 · When</legend>
              <div className="crm-chips" style={{ alignItems: 'center' }}>
                <button type="button" className="crm-chip is-soft" aria-pressed={when === 'now'} onClick={() => setWhen('now')}>Send now</button>
                <button type="button" className="crm-chip is-soft" aria-pressed={when === 'later'} onClick={() => setWhen('later')}>Schedule</button>
                {when === 'later' && <input type="datetime-local" className="crm-input" style={{ width: 'auto', height: 40 }} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} aria-label="Send at" />}
              </div>
            </fieldset>

            {error && <div className="crm-error" role="alert">{error}</div>}

            <div className="wb-actions">
              <label className="crm-field" style={{ flex: '1 1 200px' }}>Send a test to
                <input className="crm-input" inputMode="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Your mobile number" />
              </label>
              <button type="button" className="crm-btn is-secondary" disabled={!testPhone.trim() || !!busy} onClick={sendTest}>{busy === 'test' ? 'Sending…' : 'Send test'}</button>
              <button type="button" className="crm-btn is-lg" style={{ marginLeft: 'auto' }} disabled={!!busy || uploading} onClick={submit}>
                <Send size={18} aria-hidden />
                {busy === 'send' ? 'Saving…' : when === 'now' ? `Send to ${audience?.total ?? 0} people` : `Schedule for ${audience?.total ?? 0} people`}
              </button>
            </div>
          </section>

          <aside className="grow-1 wb-side" aria-label="Preview">
            <div className="crm-card wb-phone-card">
              <h2 className="crm-h2">What they will see</h2>
              <div className="wb-phone">
                <div className="wb-phone-bar">
                  <span className="wb-phone-dp">{orgName().slice(0, 1)}</span>
                  <span><strong>{orgName()}</strong><small>Business account</small></span>
                </div>
                <div className="wb-phone-chat">
                  <div className="wb-msg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a picture just picked */}
                    {!ready && needMedia && (media?.url ? <img className="wb-msg-img" src={media.url} alt="" />
                      : <span className={`wb-msg-media${media ? ' is-doc' : ''}`}>{needMedia === 'document' ? <FileText size={22} aria-hidden /> : needMedia === 'video' ? <Film size={22} aria-hidden /> : <ImagePlus size={22} aria-hidden />}{media ? media.fileName : needMedia === 'image' ? 'Your picture' : needMedia === 'document' ? 'Your PDF' : 'Your video'}</span>)}
                    {!ready && tpl?.header && (!tpl.headerFormat || tpl.headerFormat === 'TEXT') && <strong className="wb-msg-head">{tpl.header}</strong>}
                    <span className="wb-msg-body">{bodyPreview || '…'}</span>
                    {!ready && tpl?.footer && <span className="wb-msg-foot">{tpl.footer}</span>}
                    <span className="wb-msg-time">9:00 am</span>
                    {!ready && tpl && tpl.buttons.length > 0 && (
                      <span className="wb-msg-btns">{tpl.buttons.map((b, i) => <span key={i}>{b.type === 'URL' ? '↗ ' : b.type === 'PHONE_NUMBER' ? '☎ ' : '↩ '}{b.text}</span>)}</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="crm-sub wb-side-note">
                {ready ? '[Name] becomes each person’s name.' : 'Blanks set to “their name” show each person’s first name (Reena here).'} Anyone who replies STOP is removed automatically; replies arrive in the WhatsApp inbox.
              </p>
            </div>
          </aside>
        </div>
      )}

      <section className="crm-card is-flush" aria-labelledby="hist-h">
        <div className="crm-card-head"><h2 id="hist-h" className="crm-h2">Recent broadcasts</h2></div>
        {history.error && <div style={{ padding: '0 22px' }}><ErrorBox message={history.error} onRetry={history.reload} /></div>}
        {!history.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={120} /></div> : history.data.length === 0 ? <Empty title="No broadcasts yet" /> : (
          <><div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 760 }}>
              <thead><tr><th>Message</th><th className="num">Sent to</th><th className="num">Delivered</th><th className="num">Read</th><th className="num">Replies</th><th>Status</th></tr></thead>
              <tbody>
                {histPg.rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="crm-cell-main">{b.title}</div>
                      <div className="crm-cell-sub">{fmt.dateTime(b.sentAt ?? b.scheduledAt ?? b.createdAt)}{b.audience ? ` · ${b.audience}` : ''}</div>
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
            <Pager {...histPg.pager} noun="broadcasts" /></>
        )}
      </section>
      {toast}
    </div>
  );
}
