'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, BookOpen, CalendarDays, History, MapPin, Plus, Search, Tent } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit as canEditPage, useAccess } from '@/lib/crm/access';
import { Pager } from '@/components/crm/Pager';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { Empty, ErrorBox, friendlyError, PageHead, Pill, rupees, Skeleton, useToast } from '@/components/crm/ui';
import { CampForm } from '@/components/crm/camps/CampForm';
import { CampDetail } from '@/components/crm/camps/CampDetail';
import { CAMP_STATUS, campDate, daysTo, pct, type CampOptions, type CampRow, type CountRow } from '@/components/crm/camps/shared';

interface ListRes { items: CampRow[]; total: number; counts: { upcoming: number; past: number; cancelled: number } }
interface Insights {
  camps: number; attended: number; referred: number; arrived: number; prebookedShare: number; spent: number;
  symptoms: CountRow[]; conditions: (CountRow & { dept: string })[];
  byBlock: { block: string; total: number; top: CountRow[] }[];
  byType: { type: string; label: string; camps: number; attended: number; referred: number; arrived: number; spent: number }[];
  ages: { children: number; adults: number; over60: number; women: number; men: number };
}

export default function CampsPageWrap() {
  return <Suspense fallback={<main className="crm-page"><Skeleton h={480} /></main>}><CampsPage /></Suspense>;
}

function CampsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const openId = params.get('id');
  const { access } = useAccess();
  const editable = canEditPage(access, 'camps');
  const [tab, setTab] = usePageTab(['upcoming', 'past', 'insights', 'playbook'] as const, 'upcoming');
  const [options, setOptions] = useState<CampOptions | null>(null);
  const [planning, setPlanning] = useState(false);
  const [counts, setCounts] = useState<ListRes['counts'] | null>(null);
  const [toast, showToast] = useToast();
  useEffect(() => { crm.get<CampOptions>('/api/v1/camps/options').then(setOptions).catch(() => undefined); }, []);
  const open = (id: string | null) => router.push(id ? `/admin/camps?id=${id}` : '/admin/camps', { scroll: true });

  return (
    <main className="crm-page">
      <PageHead title="Health camps" sub="Plan camps, pre-book people, record what each person came with and what the doctors found, and follow up everyone who needs the hospital.">
        {editable && !openId && <button type="button" className="crm-btn" onClick={() => setPlanning(true)}><Plus size={16} aria-hidden /> Plan a camp</button>}
      </PageHead>

      {openId ? <CampDetail key={openId} id={openId} options={options} canEdit={editable} onBack={() => open(null)} toast={showToast} /> : (
        <>
          <PageTabs label="Camps views" value={tab} onChange={setTab} tabs={[
            { key: 'upcoming', label: 'Upcoming', icon: CalendarDays, count: counts?.upcoming },
            { key: 'past', label: 'Past camps', icon: History, count: counts?.past },
            { key: 'insights', label: 'What camps find', icon: BarChart3 },
            { key: 'playbook', label: 'Marketing playbook', icon: BookOpen },
          ]} />
          {(tab === 'upcoming' || tab === 'past') && <CampList when={tab} onOpen={open} onCounts={setCounts} canPlan={editable} onPlan={() => setPlanning(true)} />}
          {tab === 'insights' && <InsightsView />}
          {tab === 'playbook' && <Playbook />}
        </>
      )}
      {planning && <CampForm options={options} onClose={() => setPlanning(false)} onSaved={(id) => { setPlanning(false); showToast('Camp planned. Its marketing checklist is ready.'); open(id); }} />}
      {toast}
    </main>
  );
}

function CampList({ when, onOpen, onCounts, canPlan, onPlan }: { when: 'upcoming' | 'past'; onOpen: (id: string) => void; onCounts: (c: ListRes['counts']) => void; canPlan: boolean; onPlan: () => void }) {
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => new URLSearchParams({ when, page: String(page), pageSize: '12', ...(qd ? { q: qd } : {}) }).toString(), [when, page, qd]);
  const load = useCallback(async () => {
    try { const r = await crm.get<ListRes>(`/api/v1/camps?${qs}`); setData(r); onCounts(r.counts); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs, onCounts]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="cp-list">
      <label className="ch-search" style={{ margin: 0, maxWidth: 420 }}>
        <Search size={16} aria-hidden /><span className="crm-sr">Search camps</span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, code, block or venue" />
      </label>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data ? <Skeleton h={300} /> : data.items.length === 0 ? (
        <Empty title={when === 'upcoming' ? 'No camps planned' : 'No past camps yet'}>
          {when === 'upcoming' && canPlan && <button type="button" className="crm-btn" onClick={onPlan}><Plus size={16} aria-hidden /> Plan a camp</button>}
        </Empty>
      ) : (
        <div className="cp-grid">
          {data.items.map((c) => {
            const st = CAMP_STATUS[c.status] ?? CAMP_STATUS.planned;
            const left = daysTo(c.date);
            return (
              <button key={c.id} type="button" className="crm-card cp-card" onClick={() => onOpen(c.id)}>
                <span className="cp-card-top">
                  <span className="cp-date"><strong>{new Date(`${c.date}T00:00:00Z`).getUTCDate()}</strong>{new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${c.date}T00:00:00Z`))}</span>
                  <span className="cp-card-title">
                    <strong>{c.title}</strong>
                    <span className="crm-cell-sub"><MapPin size={12} aria-hidden /> {[c.venue, c.block].filter(Boolean).join(', ') || '—'}</span>
                  </span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </span>
                <span className="cp-card-meta">{c.typeLabel} · {campDate(c.date)}{when === 'upcoming' && left >= 0 ? ` · ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}` : ''} · code {c.code}</span>
                <span className="cp-card-nums">
                  <span><strong>{c.booked}</strong> {when === 'upcoming' ? `booked of ${c.capacity}` : 'registered'}</span>
                  <span><strong>{c.attended}</strong> seen</span>
                  <span><strong>{c.referred}</strong> to hospital</span>
                  <span><strong>{c.arrived}</strong> came</span>
                </span>
                {when === 'upcoming' ? (
                  <span className="cp-card-plan"><span className="cp-progress"><span style={{ width: `${pct(c.checklistDone, c.checklistTotal)}%` }} /></span>Plan {c.checklistDone}/{c.checklistTotal}</span>
                ) : (
                  <span className="cp-card-plan">{c.spent ? `${rupees(c.spent)} spent${c.arrived ? ` · ${rupees(Math.round(c.spent / c.arrived))} per hospital visit` : ''}` : 'Cost not recorded'}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / 12))} total={data.total} size={12} onPage={setPage} noun="camps" compact />}
    </div>
  );
}

function Bars({ rows, tone, suffix }: { rows: CountRow[]; tone: string; suffix?: (r: CountRow) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <span className="crm-cell-sub">Nothing recorded yet.</span>;
  return (
    <div className="cp-bars">
      {rows.map((r) => (
        <div key={r.code} className="cp-bar-row">
          <span title={suffix?.(r)}>{r.label}{suffix && <span className="crm-cell-sub"> · {suffix(r)}</span>}</span>
          <span className="crm-bar"><span style={{ width: `${pct(r.n, max)}%`, background: tone }} /></span>
          <strong>{r.n}</strong>
        </div>
      ))}
    </div>
  );
}

const PERIODS = [{ d: 90, l: '3 months' }, { d: 180, l: '6 months' }, { d: 365, l: '12 months' }];

function InsightsView() {
  const [days, setDays] = useState(365);
  const [d, setD] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setD(await crm.get<Insights>(`/api/v1/camps/insights?days=${days}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [days]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  if (error && !d) return <ErrorBox message={error} onRetry={load} />;
  return (
    <div className="cp-insights">
      <div className="crm-chips">{PERIODS.map((p) => <button key={p.d} type="button" className="crm-chip" aria-pressed={days === p.d} onClick={() => setDays(p.d)}>{p.l}</button>)}</div>
      {!d ? <Skeleton h={400} /> : (
        <>
          <section className="ld-kpis">
            <div className="crm-card ld-kpi"><span className="crm-kpi-label">Camps</span><span className="ld-kpi-value">{d.camps}</span></div>
            <div className="crm-card ld-kpi"><span className="crm-kpi-label">People seen</span><span className="ld-kpi-value">{d.attended}</span><span className="ld-kpi-sub">{d.prebookedShare}% pre-booked</span></div>
            <div className="crm-card ld-kpi"><span className="crm-kpi-label">Sent to hospital</span><span className="ld-kpi-value">{d.referred}</span><span className="ld-kpi-sub">{pct(d.referred, d.attended)}% of seen</span></div>
            <div className="crm-card ld-kpi is-ok"><span className="crm-kpi-label">Came to hospital</span><span className="ld-kpi-value">{d.arrived}</span><span className="ld-kpi-sub">{pct(d.arrived, d.referred)}% of referred</span></div>
            <div className="crm-card ld-kpi"><span className="crm-kpi-label">Cost per hospital visit</span><span className="ld-kpi-value">{d.arrived ? rupees(Math.round(d.spent / d.arrived)) : '—'}</span><span className="ld-kpi-sub">{rupees(d.spent)} spent</span></div>
          </section>
          <div className="crm-row">
            <section className="crm-card grow-1" style={{ flexBasis: 380 }}>
              <div className="crm-card-head"><h2 className="crm-h2">Most common findings</h2></div>
              <Bars rows={d.conditions} tone="var(--accent)" suffix={(r) => (r as CountRow & { dept?: string }).dept ?? ''} />
            </section>
            <section className="crm-card grow-1" style={{ flexBasis: 380 }}>
              <div className="crm-card-head"><h2 className="crm-h2">Most common symptoms</h2></div>
              <Bars rows={d.symptoms} tone="#7c3aed" />
            </section>
          </div>
          <div className="crm-row">
            <section className="crm-card grow-1" style={{ flexBasis: 380 }}>
              <div className="crm-card-head"><h2 className="crm-h2">Which camps bring patients</h2></div>
              {d.byType.length === 0 ? <span className="crm-cell-sub">No camps yet.</span> : (
                <div className="crm-table-wrap"><table className="crm-table">
                  <thead><tr><th>Type</th><th style={{ textAlign: 'right' }}>Camps</th><th style={{ textAlign: 'right' }}>Seen</th><th style={{ textAlign: 'right' }}>To hospital</th><th style={{ textAlign: 'right' }}>Came</th><th style={{ textAlign: 'right' }}>₹ per visit</th></tr></thead>
                  <tbody>{d.byType.map((t) => (
                    <tr key={t.type}><td><strong>{t.label}</strong></td><td className="num" style={{ textAlign: 'right' }}>{t.camps}</td><td className="num" style={{ textAlign: 'right' }}>{t.attended}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{t.referred}</td><td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{t.arrived}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{t.arrived && t.spent ? rupees(Math.round(t.spent / t.arrived)) : '—'}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
            <section className="crm-card grow-1" style={{ flexBasis: 380 }}>
              <div className="crm-card-head"><h2 className="crm-h2">What each block needs</h2></div>
              {d.byBlock.length === 0 ? <span className="crm-cell-sub">No findings yet.</span> : (
                <ul className="crm-list">{d.byBlock.slice(0, 12).map((b) => (
                  <li key={b.block}><span style={{ flex: 1, minWidth: 0 }}><strong>{b.block}</strong>
                    <span className="crm-cell-sub wl-sub">{b.top.map((t) => `${t.label} (${t.n})`).join(' · ')}</span></span></li>
                ))}</ul>
              )}
              <p className="crm-sub" style={{ fontSize: 12.5 }}>Plan the next camp in each block around its top findings.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

const PLAYBOOK: { title: string; points: string[] }[] = [
  { title: 'Pick the camp from the data', points: [
    'Choose the block and type from “What camps find” and the panchayat survey answers: where joint pain, BP or eye problems are common, run that camp.',
    'Go where partners are strong but referrals are low: a camp wakes up a quiet area. Panchayat coverage shows these.',
    'Match the camp to a department with free OPD slots in the following week, so referred patients can be seen quickly.',
  ] },
  { title: 'Build demand before the day', points: [
    'Partner with the local mukhiya, ASHA workers and RMP doctors. Ask each ASHA to bring 10 people who need a check-up; credit them for those who come to the hospital.',
    'QR posters with the camp code at the PHC, chemists, schools and the haat. Scanning books a token on WhatsApp.',
    'WhatsApp broadcast to all partners in the block a week before, a reminder 2 days before, and a mic or e-rickshaw announcement the day before.',
    'Aim for at least half the slots pre-booked. Pre-booked people come with old reports and usually need care.',
  ] },
  { title: 'Make the day count', points: [
    'One registration desk with token numbers, then screening (BP, sugar, SpO2, weight), then the doctor. Record symptoms and findings for everyone.',
    'Ask for consent before writing health details. It builds trust and is needed for follow-up.',
    'Give each referred patient a hospital slip: department, date to come, desk number and any camp discount.',
    'Take photos and a 30-second video (with permission) for WhatsApp status and social media.',
  ] },
  { title: 'Turn findings into hospital visits', points: [
    'Everyone the doctor refers lands in the Leads inbox. Call within 2 days and book the visit; reply-time matters most.',
    'Offer a clear reason to come: free consultation, a discounted test, or the same doctor from the camp.',
    'Track who came (Came to hospital) and the cost per hospital visit for each camp type and block.',
  ] },
  { title: 'Keep partners and the village engaged', points: [
    'Thank-you WhatsApp to partners with how many people they brought, and credit referral payments promptly.',
    'Share a short update in the village: “120 people screened, 18 helped at the hospital”.',
    'Repeat successful camps every 3–4 months in the same place; people come back with family.',
  ] },
];

function Playbook() {
  return (
    <div className="cp-playbook">
      <div className="ld-banner"><Tent size={18} aria-hidden /><span>Every new camp gets this as its checklist (Marketing plan). Change any camp&apos;s steps to suit it.</span></div>
      <div className="cp-play-grid">
        {PLAYBOOK.map((s, i) => (
          <section key={s.title} className="crm-card cp-play">
            <span className="wa-num">{i + 1}</span>
            <h2 className="crm-h2">{s.title}</h2>
            <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}
