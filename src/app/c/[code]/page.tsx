'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Clock, MapPin, Phone, Plus, Share2, Stethoscope, Ticket } from 'lucide-react';
import { LANGS, TEXT, clock, dateParts, problemsFor, type Lang, type TextKey } from './text';
import './camp-book.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

interface Camp {
  code: string; title: string; type: string; typeLabel: string; date: string; startTime: string; endTime: string;
  venue: string | null; block: string | null; district: string | null; doctors: string | null; departments: string | null;
  state: 'open' | 'full' | 'over' | 'cancelled'; placesLeft: number; isToday: boolean; hospital: string; phone: string | null; places: string[];
}
interface Booked { token: number; name: string }
type Field = 'name' | 'age' | 'sex' | 'phone' | 'village';

/** "+91 99550 12345" from "919955012345". */
const showPhone = (p: string) => (p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : `+${p}`);

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/**
 * The page a person opens by scanning a health camp's QR poster. What the camp is, and a short form to book a place;
 * the token number shows on the page. Hindi first, with English and Bangla. No sign-in.
 */
export default function CampBookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [lang, setLang] = useState<Lang>('hi');
  const [camp, setCamp] = useState<Camp | null>(null);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);

  useEffect(() => {
    const saved = store.get<Lang | null>('campbook.lang', null);
    // The language chosen last time on this phone (read after the first paint, so the server page matches).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setLang(saved);
    else if (navigator.language?.startsWith('bn')) setLang('bn');
  }, []);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/v1/public/camps/${encodeURIComponent(code)}`)
      .then(async (r) => { if (!alive) return; if (r.status === 404) setError('notFound'); else if (!r.ok) setError('failed'); else setCamp(await r.json()); })
      .catch(() => { if (alive) setError('failed'); });
    return () => { alive = false; };
  }, [code]);
  useEffect(() => { document.documentElement.lang = lang; if (camp) document.title = `${camp.title} · ${camp.hospital}`; }, [lang, camp]);

  const t = (k: TextKey, v?: Record<string, string | number>) => Object.entries(v ?? {}).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, String(b)), TEXT[lang][k]);
  const pickLang = (l: Lang) => { setLang(l); store.set('campbook.lang', l); };

  return (
    <div className="cb" lang={lang}>
      <div className="cb-langs" role="group" aria-label="Language">
        {LANGS.map((l) => (
          <button key={l.key} type="button" className={l.key === lang ? 'is-on' : ''} aria-pressed={l.key === lang} onClick={() => pickLang(l.key)}>{l.label}</button>
        ))}
      </div>
      {!camp && !error && <div className="cb-loading" role="status"><span className="cb-spin" aria-hidden />{t('loading')}</div>}
      {error && <div className="cb-shell"><div className="cb-card cb-msg" role="alert">{error === 'notFound' ? t('notFound') : t('failed')}</div></div>}
      {camp && <CampView camp={camp} code={code} lang={lang} t={t} />}
    </div>
  );
}

function CampView({ camp, code, lang, t }: { camp: Camp; code: string; lang: Lang; t: (k: TextKey, v?: Record<string, string | number>) => string }) {
  const d = dateParts(camp.date, lang);
  const when = `${camp.isToday ? t('today') : `${d.weekday}, ${d.day} ${d.month}`} · ${clock(camp.startTime, lang)} – ${clock(camp.endTime, lang)}`;
  const where = [camp.venue, camp.block, camp.district].filter(Boolean).join(', ');
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([camp.venue, camp.block, camp.district, 'Bihar'].filter(Boolean).join(', '))}`;
  const kBooked = `campbook.${code.toUpperCase()}`;
  const [mine, setMine] = useState<Booked[]>([]);
  const [done, setDone] = useState<(Booked & { existed: boolean }) | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMine(store.get<Booked[]>(kBooked, [])); }, [kBooked]);

  const onBooked = (b: Booked & { existed: boolean }) => {
    const list = [b, ...mine.filter((x) => x.token !== b.token)].slice(0, 12);
    setMine(list); store.set(kBooked, list); setDone(b);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="cb-shell">
      <header className="cb-hero">
        <span className="cb-hospital">{camp.hospital}</span>
        <h1 className="cb-title">{camp.title}</h1>
        <div className="cb-badges">
          <span className="cb-badge is-free"><Stethoscope size={15} aria-hidden /> {t('free')}</span>
          {camp.state === 'open' && camp.placesLeft <= 40 && <span className="cb-badge is-left">{t('placesLeft', { n: camp.placesLeft })}</span>}
        </div>
        <div className="cb-when">
          <div className="cb-date" aria-hidden><span className="cb-date-d">{d.day}</span><span className="cb-date-m">{d.month}</span></div>
          <div className="cb-when-lines">
            <span><CalendarDays size={16} aria-hidden /> {camp.isToday ? t('today') : d.weekday}, {d.day} {d.month}</span>
            <span><Clock size={16} aria-hidden /> {clock(camp.startTime, lang)} – {clock(camp.endTime, lang)}</span>
            {where && <a href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={16} aria-hidden /> {where}</a>}
          </div>
        </div>
        {camp.doctors && <p className="cb-doctors"><strong>{t('doctors')}:</strong> {camp.doctors}</p>}
      </header>

      {done ? (
        <Done camp={camp} booked={done} when={when} where={where} t={t} onAnother={() => setDone(null)} />
      ) : camp.state === 'open' ? (
        <BookForm camp={camp} code={code} lang={lang} t={t} onBooked={onBooked} />
      ) : (
        <div className="cb-card cb-msg" role="status">
          <strong>{camp.state === 'full' ? t('full') : camp.state === 'over' ? t('over') : t('cancelled')}</strong>
          {camp.state === 'full' && <p>{t('fullSub')}</p>}
          {camp.phone && camp.state !== 'over' && <a className="cb-btn is-ghost" href={`tel:+${camp.phone}`}><Phone size={18} aria-hidden /> {t('call')}</a>}
        </div>
      )}

      {mine.length > 0 && !done && (
        <section className="cb-card cb-mine" aria-label={t('yourTokens')}>
          <h2>{t('yourTokens')}</h2>
          <ul>{mine.map((b) => <li key={b.token}><span className="cb-mine-tok">{b.token}</span>{b.name}</li>)}</ul>
        </section>
      )}
      <footer className="cb-foot">{camp.hospital}{camp.phone ? <> · <a href={`tel:+${camp.phone}`}>{showPhone(camp.phone)}</a></> : null}</footer>
    </div>
  );
}

function BookForm({ camp, code, lang, t, onBooked }: {
  camp: Camp; code: string; lang: Lang; t: (k: TextKey, v?: Record<string, string | number>) => string; onBooked: (b: Booked & { existed: boolean }) => void;
}) {
  // A second person from the same family keeps the mobile and village.
  const last = store.get<{ phone?: string; village?: string }>('campbook.last', {});
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'O' | ''>('');
  const [phone, setPhone] = useState(last.phone ?? '');
  const [village, setVillage] = useState(last.village ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [consent, setConsent] = useState(true);
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [focusV, setFocusV] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const sexRef = useRef<HTMLButtonElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const villageRef = useRef<HTMLInputElement>(null);
  /** The field to move to when it needs fixing (used in handlers only). */
  const fieldEl = (f: Field): HTMLElement | null => ({ name: nameRef, age: ageRef, sex: sexRef, phone: phoneRef, village: villageRef }[f].current);

  const problems = problemsFor(camp.type);
  const suggestions = useMemo(() => {
    const q = village.trim().toLowerCase();
    if (q.length < 1) return [];
    return camp.places.filter((p) => p.toLowerCase().startsWith(q) && p.toLowerCase() !== q).slice(0, 6)
      .concat(camp.places.filter((p) => !p.toLowerCase().startsWith(q) && p.toLowerCase().includes(q)).slice(0, 3));
  }, [village, camp.places]);

  const digits = phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const check = () => {
    const e: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) e.name = t('needName');
    const a = Number(age);
    if (!age || !Number.isInteger(a) || a < 0 || a > 120) e.age = t('needAge');
    if (!sex) e.sex = t('needSex');
    if (digits && !/^[6-9]\d{9}$/.test(digits)) e.phone = t('needPhone');
    if (!village.trim()) e.village = t('needVillage');
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e = check();
    setErrs(e); setFailed(null);
    const first = (['name', 'age', 'sex', 'phone', 'village'] as Field[]).find((k) => e[k]);
    if (first) { const el = fieldEl(first); el?.focus(); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setBusy(true);
    const complaint = [...picked, other.trim()].filter(Boolean).join(', ');
    try {
      const r = await fetch(`${API}/api/v1/public/camps/${encodeURIComponent(code)}/book`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), age: Number(age), sex, phone: digits || null, village: village.trim(), complaint, consent: consent && !!digits, website: trap }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 429) { setFailed(t('tooMany')); return; }
      if (!r.ok) {
        const f = body.field as Field | undefined;
        if (f && ['name', 'age', 'sex', 'phone', 'village'].includes(f)) { setErrs({ [f]: body.message }); fieldEl(f)?.focus(); } else setFailed(body.message ?? t('failed'));
        return;
      }
      store.set('campbook.last', { phone: digits, village: village.trim() });
      onBooked({ token: body.token, name: body.name ?? name.trim(), existed: !!body.existed });
    } catch { setFailed(t('failed')); } finally { setBusy(false); }
  };

  const err = (k: Field) => (errs[k] ? <span className="cb-err" id={`e-${k}`} role="alert">{errs[k]}</span> : null);
  const clear = (k: Field) => errs[k] && setErrs((x) => ({ ...x, [k]: undefined }));

  return (
    <form className="cb-card cb-form" onSubmit={submit} noValidate>
      <div className="cb-form-head">
        <h2>{t('formTitle')}</h2>
        <p>{t('formSub')}</p>
      </div>

      <label className="cb-field">
        <span className="cb-label">{t('name')}</span>
        <input ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); clear('name'); }} placeholder={t('namePh')} autoComplete="name" maxLength={80}
          aria-invalid={!!errs.name} aria-describedby={errs.name ? 'e-name' : undefined} enterKeyHint="next" />
        {err('name')}
      </label>

      <div className="cb-row">
        <label className="cb-field cb-age">
          <span className="cb-label">{t('age')}</span>
          <input ref={ageRef} value={age} onChange={(e) => { setAge(e.target.value.replace(/\D/g, '').slice(0, 3)); clear('age'); }} placeholder={t('agePh')}
            inputMode="numeric" aria-invalid={!!errs.age} aria-describedby={errs.age ? 'e-age' : undefined} />
        </label>
        <div className="cb-field cb-sex">
          <span className="cb-label" id="l-sex">{t('gender')}</span>
          <div className="cb-seg" role="radiogroup" aria-labelledby="l-sex" aria-describedby={errs.sex ? 'e-sex' : undefined}>
            {(['F', 'M', 'O'] as const).map((s, i) => (
              <button key={s} ref={i === 0 ? sexRef : undefined} type="button" role="radio" aria-checked={sex === s} className={sex === s ? 'is-on' : ''}
                onClick={() => { setSex(s); clear('sex'); }}>{s === 'F' ? t('female') : s === 'M' ? t('male') : t('other')}</button>
            ))}
          </div>
        </div>
      </div>
      {(errs.age || errs.sex) && <div className="cb-errs">{err('age')}{err('sex')}</div>}

      <label className="cb-field">
        <span className="cb-label">{t('mobile')} <em>({t('optional')})</em></span>
        <span className="cb-phone">
          <span aria-hidden>+91</span>
          <input ref={phoneRef} value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d\s+]/g, '').slice(0, 14)); clear('phone'); }} inputMode="tel" autoComplete="tel-national"
            placeholder="98765 43210" aria-invalid={!!errs.phone} aria-describedby={errs.phone ? 'e-phone' : 'h-phone'} />
        </span>
        {err('phone') ?? <span className="cb-hint" id="h-phone">{t('mobileHint')}</span>}
      </label>

      <div className="cb-field">
        <label className="cb-label" htmlFor="village">{t('village')}</label>
        <input id="village" ref={villageRef} value={village} onChange={(e) => { setVillage(e.target.value); clear('village'); }} placeholder={t('villagePh')} autoComplete="off" maxLength={80}
          onFocus={() => setFocusV(true)} onBlur={() => setTimeout(() => setFocusV(false), 150)} aria-invalid={!!errs.village} aria-describedby={errs.village ? 'e-village' : undefined} />
        {focusV && suggestions.length > 0 && (
          <div className="cb-sugg" role="listbox" aria-label={t('village')}>
            {suggestions.map((s) => (
              <button key={s} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { setVillage(s); clear('village'); setFocusV(false); }}>
                <MapPin size={14} aria-hidden /> {s}
              </button>
            ))}
          </div>
        )}
        {err('village')}
      </div>

      <fieldset className="cb-field cb-probs">
        <legend className="cb-label">{t('problem')} <em>{t('problemHint')}</em></legend>
        <div className="cb-chips">
          {problems.map((p) => {
            const on = picked.includes(p.en);
            return (
              <button key={p.en} type="button" aria-pressed={on} className={on ? 'is-on' : ''} onClick={() => setPicked((x) => (on ? x.filter((y) => y !== p.en) : [...x, p.en]))}>
                {on && <Check size={15} aria-hidden />}{p[lang]}
              </button>
            );
          })}
        </div>
        <textarea value={other} onChange={(e) => setOther(e.target.value.slice(0, 240))} placeholder={t('otherPh')} rows={2} aria-label={t('otherPh')} />
      </fieldset>

      {digits.length === 10 && (
        <label className="cb-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('consent')}</span>
        </label>
      )}

      {/* People never see this; bots fill it in. */}
      <input className="cb-trap" tabIndex={-1} autoComplete="off" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />

      {failed && <div className="cb-failed" role="alert">{failed}</div>}
      <div className="cb-submit">
        <button type="submit" className="cb-btn" disabled={busy}>
          {busy ? <><span className="cb-spin is-light" aria-hidden />{t('booking')}</> : <><Ticket size={20} aria-hidden />{t('book')}</>}
        </button>
      </div>
    </form>
  );
}

function Done({ camp, booked, when, where, t, onAnother }: {
  camp: Camp; booked: Booked & { existed: boolean }; when: string; where: string; t: (k: TextKey, v?: Record<string, string | number>) => string; onAnother: () => void;
}) {
  const text = t('shareText', { camp: camp.title, token: booked.token, when, where });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section className="cb-card cb-done" aria-live="polite" ref={ref} tabIndex={-1}>
      <div className="cb-done-tick" aria-hidden><Check size={34} strokeWidth={3} /></div>
      <h2>{t('doneTitle')}</h2>
      {booked.existed && <p className="cb-done-note">{t('already')}</p>}
      <div className="cb-ticket">
        <span className="cb-ticket-label">{t('token')}</span>
        <span className="cb-ticket-num">{booked.token}</span>
        <span className="cb-ticket-name">{booked.name}</span>
        <span className="cb-ticket-when">{when}</span>
        {where && <span className="cb-ticket-where">{where}</span>}
      </div>
      <p className="cb-done-show">{t('showThis')}</p>
      <p className="cb-done-tip">{t('bring')} {t('saveTip')}</p>
      <div className="cb-done-actions">
        <a className="cb-btn is-wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Share2 size={18} aria-hidden /> {t('shareWa')}</a>
        <button type="button" className="cb-btn is-ghost" onClick={onAnother}><Plus size={18} aria-hidden /> {t('another')}</button>
      </div>
    </section>
  );
}
