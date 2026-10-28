'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Crosshair, MapPin, Navigation, Phone, Star, X } from 'lucide-react';
import { geo, SOURCE_LABEL, STATUS_META, type PanchayatDetail, type PanchayatPerson } from '@/lib/crm/geo';
import { contactTypeLabel, Empty, ErrorBox, fmt, friendlyError, Pill, Skeleton, stageTone, useLoader } from '@/components/crm/ui';

type Tab = 'people' | 'snapshot' | 'visits' | 'referrals';

interface Props {
  id: string;
  from?: string;
  to?: string;
  canEditPartners: boolean;
  canEditField: boolean;
  onClose: () => void;
  /** On the map page: start dragging this panchayat's pin. */
  onMovePin?: (d: PanchayatDetail) => void;
  /** Shown when the panel is opened somewhere other than the map. */
  showMapLink?: boolean;
  onToast: (msg: string) => void;
  /** Bumped by the parent to force a reload (e.g. after the pin moved). */
  version?: number;
}

export default function PanchayatPanel({ id, from, to, canEditPartners, canEditField, onClose, onMovePin, showMapLink, onToast, version = 0 }: Props) {
  const [tab, setTab] = useState<Tab>('people');
  const detail = useLoader(() => geo.panchayat(id, { from, to }), [id, from, to, version]);
  const d = detail.data;

  return (
    <section className="geo-panel" aria-label={d ? `Panchayat ${d.name}` : 'Panchayat'}>
      <header className="geo-panel-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="crm-sub" style={{ fontSize: 12 }}>{d ? `${d.block} · ${d.district}` : 'Panchayat'}</span>
          <h2 className="crm-h2" style={{ fontSize: 20 }}>{d?.name ?? <Skeleton h={22} w={160} />}</h2>
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onClose} aria-label="Close panchayat" style={{ width: 36, padding: 0 }}>
          <X size={16} aria-hidden />
        </button>
      </header>

      {detail.error && <ErrorBox message={detail.error} onRetry={detail.reload} />}
      {!d ? <Skeleton h={320} /> : (
        <>
          <div className="geo-status-row">
            <span className="geo-status" style={{ ['--c' as string]: STATUS_META[d.metrics.status].color }}>
              <span className="geo-swatch" aria-hidden="true" />
              {STATUS_META[d.metrics.status].label}
            </span>
            {d.metrics.champions > 0 && <Pill tone="ok">{d.metrics.champions} champion{d.metrics.champions === 1 ? '' : 's'}</Pill>}
            {d.metrics.lastVisitAt && <span className="crm-sub" style={{ fontSize: 12 }}>Last visit {fmt.date(d.metrics.lastVisitAt)}</span>}
          </div>

          <div className="geo-loc">
            <MapPin size={15} aria-hidden />
            <span style={{ flex: 1, minWidth: 0 }}>
              {SOURCE_LABEL[d.source]}
              {d.source === 'field' && ` (${d.fieldCheckIns} check-in${d.fieldCheckIns === 1 ? '' : 's'})`}
              {d.source === 'manual' && d.manualSetBy && ` by ${d.manualSetBy}`}
            </span>
          </div>
          <div className="crm-chips">
            {d.lat != null && d.lng != null && (
              <a className="crm-btn is-secondary is-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`} target="_blank" rel="noreferrer">
                <Navigation size={14} aria-hidden /> Directions
              </a>
            )}
            {onMovePin && canEditField && (
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onMovePin(d)}>
                <Crosshair size={14} aria-hidden /> {d.source === 'block' ? 'Place pin' : 'Move pin'}
              </button>
            )}
            {showMapLink && (
              <Link className="crm-btn is-secondary is-sm" href={`/admin/map?panchayat=${encodeURIComponent(d.id)}`}>
                <MapPin size={14} aria-hidden /> Open on map
              </Link>
            )}
          </div>

          <div className="geo-metrics">
            <Metric label="Visits" value={d.metrics.visits} sub={`${d.metrics.visitsAllTime} all time`} />
            <Metric label="Partners" value={d.metrics.partners} sub={`${d.metrics.important} important`} />
            <Metric label="Referrals" value={d.metrics.referrals} sub={`${d.metrics.referralsAllTime} all time`} />
            <Metric label="Admitted" value={d.metrics.admitted} sub="in this period" />
          </div>

          <div className="crm-tabs" role="tablist" aria-label="Panchayat details">
            {([
              ['people', `People (${d.people.length})`],
              ['snapshot', 'Snapshot'],
              ['visits', `Visits (${d.metrics.visitsAllTime})`],
              ['referrals', 'Referrals'],
            ] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" role="tab" className="crm-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'people' && <People d={d} canEdit={canEditPartners || canEditField} onToast={onToast} onChanged={detail.reload} />}
          {tab === 'snapshot' && <Snapshot d={d} />}
          {tab === 'visits' && <Visits d={d} />}
          {tab === 'referrals' && (
            d.referrals.length === 0 ? <Empty title="No referrals yet">Nobody from this panchayat has been referred to the hospital.</Empty> : (
              <ul className="crm-list">
                {d.referrals.map((r) => (
                  <li key={r.clientId}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{r.patientName}</span>
                      <span className="crm-cell-sub">{[r.department, r.partner && `via ${r.partner}`, fmt.date(r.createdAt)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Pill tone={stageTone(r.status)}>{r.stageLabel}</Pill>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="geo-metric">
      <span className="crm-kpi-label" style={{ fontSize: 12 }}>{label}</span>
      <span className="geo-metric-value">{value}</span>
      <span className="crm-cell-sub">{sub}</span>
    </div>
  );
}

function People({ d, canEdit, onToast, onChanged }: { d: PanchayatDetail; canEdit: boolean; onToast: (m: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (d.people.length === 0) {
    return <Empty title="No partners here yet">Agents add ASHA workers, RMPs, chemists and ward members as they visit.</Empty>;
  }
  const toggle = async (p: PanchayatPerson) => {
    setBusy(p.clientId);
    try {
      await geo.setChampion(p.clientId, !p.champion);
      onToast(p.champion ? `${p.name} is no longer a champion.` : `${p.name} is now a patient-flow champion for ${d.name}.`);
      onChanged();
    } catch (e) {
      onToast(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="crm-sub" style={{ fontSize: 12, margin: 0 }}>
        Ranked by patients sent. {canEdit ? 'Tap ★ to mark up to 3 patient-flow champions.' : 'Champions are marked ★.'}
      </p>
      <ul className="crm-list geo-people">
        {d.people.map((p) => (
          <li key={p.clientId} className={p.champion ? 'is-champion' : undefined}>
            <button type="button" className="geo-star" aria-pressed={p.champion} disabled={!canEdit || busy === p.clientId}
              onClick={() => toggle(p)} aria-label={p.champion ? `Remove ${p.name} as champion` : `Mark ${p.name} as champion`}
              title={p.champion ? 'Champion — tap to remove' : 'Mark as champion'}>
              <Star size={18} aria-hidden fill={p.champion ? 'currentColor' : 'none'} />
            </button>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.name}
                {p.important && <Pill tone="accent">Important</Pill>}
              </span>
              <span className="crm-cell-sub">
                {[p.profession || contactTypeLabel(p.role), p.lastReferralAt ? `last patient ${fmt.date(p.lastReferralAt)}` : `added by ${p.addedBy}`].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="geo-count" title={`${p.referrals} referred · ${p.admitted} admitted`}>
              <strong>{p.referrals}</strong>
              <span>{p.admitted} adm.</span>
            </span>
            {p.phone && (
              <a className="crm-btn is-secondary is-sm" href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} style={{ width: 36, padding: 0 }}>
                <Phone size={14} aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Snapshot({ d }: { d: PanchayatDetail }) {
  const s = d.snapshot;
  if (s.responses === 0) {
    return <Empty title="No survey answers yet">When an agent visits, they ask partners the six panchayat questions. Answers add up here.</Empty>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span className="crm-sub" style={{ fontSize: 12 }}>{s.responses} people answered · latest {fmt.date(s.lastAt)}</span>
      {s.questions.map((q) => (
        <div key={q.questionId} className="geo-q">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{q.title}</strong>
            <span className="crm-cell-sub" style={{ marginLeft: 'auto' }}>{q.respondents} answered</span>
          </div>
          {q.answers.length === 0 ? <span className="crm-cell-sub">No answers yet.</span> : q.answers.slice(0, 3).map((a) => {
            const pct = q.respondents ? Math.round((a.count / q.respondents) * 100) : 0;
            return (
              <div key={a.full} className="geo-q-row" title={a.full}>
                <span className="geo-q-label">{a.label}</span>
                <span className="crm-bar" style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></span>
                <span className="geo-q-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Visits({ d }: { d: PanchayatDetail }) {
  if (d.visits.length === 0) return <Empty title="Not visited yet">No agent has checked in here.</Empty>;
  return (
    <>
      <div className="crm-chips">
        {d.agents.map((a) => (
          <Link key={a.agentId} className="crm-chip" href={`/admin/activity?agent=${encodeURIComponent(a.agentId)}`}>
            {a.name} · {a.visits}
          </Link>
        ))}
      </div>
      <ul className="crm-list">
        {d.visits.map((v, i) => (
          <li key={i}>
            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{v.agent}</span>
              <span className="crm-cell-sub">{fmt.dateTime(v.checkInAt)}</span>
            </span>
            <span className="crm-cell-sub">{v.minutes != null ? `${v.minutes} min` : 'Still there'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
