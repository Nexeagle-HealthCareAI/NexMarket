'use client';

import { useMemo, useState } from 'react';
import { Copy, Globe, Link2, Pause, Pencil, Play, Plus, QrCode, Signpost } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, rupees, Skeleton, useLoader, useToast } from '@/components/crm/ui';
import { QrPosterModal, type QrPosterInfo } from '@/components/crm/QrPoster';

interface Row { key: string; label: string; leads: number; contacted: number; appointment: number; came: number; admitted: number; lost: number; cost?: number | null }
interface Report {
  days: number; total: Row; unknown: number; unknownShare: number;
  bySource: Row[]; byLink: Row[]; campaigns: Row[]; byPartner: Row[];
  weeks: { week: string; total: number; came: number }[];
  googleAds?: { spend: number; currency: string; leads: number; came: number; admitted: number; perLead?: number | null; perPatient?: number | null; sendsToAds: boolean } | null;
}
interface LinkItem {
  id: string; code: string; name: string; channel: string; hoardingId?: string | null; hoarding?: string | null; cost?: number | null; note?: string | null;
  isActive: boolean; createdAt: string; leads: number; came: number; links: { whatsapp: string | null; message: string; website: string | null };
}
interface LinksRes { connected: boolean; siteUrl?: string | null; channels: { code: string; label: string }[]; items: LinkItem[] }
interface Hoarding { id: string; place: string; block?: string | null; rent?: number | null; status: string }

const PERIODS = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '3 months' }, { d: 365, l: '12 months' }, { d: 0, l: 'All time' }];
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const weekFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Where every lead came from, and how many of them came to the hospital. Tracked links close the gap for plain WhatsApp messages. */
export default function LeadSourcesPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'whatsapp') || canEdit(access, 'analytics');
  const [days, setDays] = useState(90);
  const [toast, showToast] = useToast();
  const report = useLoader(() => crm.get<Report>(`/api/v1/lead-sources/report?days=${days}`), [days]);
  const links = useLoader(() => crm.get<LinksRes>('/api/v1/lead-sources/links'));
  const [editing, setEditing] = useState<LinkItem | 'new' | null>(null);
  const [qr, setQr] = useState<QrPosterInfo | null>(null);

  const r = report.data;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied.`); } catch { showToast('Copy didn’t work. Select the text and copy it.'); }
  };
  const toggle = async (l: LinkItem) => {
    try { await crm.put(`/api/v1/lead-sources/links/${l.id}`, { isActive: !l.isActive }); void links.reload(); showToast(l.isActive ? 'Paused. Old QR codes still credit leads to it.' : 'Active again.'); }
    catch (e) { showToast(friendlyError(e)); }
  };

  return (
    <main className="crm-page ls-page">
      <PageHead title="Lead sources" sub="Where every lead came from, and how many came to the hospital. Give each place you advertise its own tracked link or QR code." />

      <div className="crm-chips" role="group" aria-label="Period">
        {PERIODS.map((p) => <button key={p.d} type="button" className="crm-chip" aria-pressed={days === p.d} onClick={() => setDays(p.d)}>{p.l}</button>)}
      </div>

      {report.error && <ErrorBox message={report.error} onRetry={report.reload} />}
      {!r ? <Skeleton h={120} /> : (
        <div className="ls-kpis">
          <div className="crm-card ls-kpi"><span>Leads</span><strong>{r.total.leads}</strong><small>{r.total.contacted} contacted</small></div>
          <div className="crm-card ls-kpi"><span>Came to the hospital</span><strong>{r.total.came}</strong><small>{pct(r.total.came, r.total.leads)}% of leads · {r.total.admitted} admitted</small></div>
          <div className={`crm-card ls-kpi${r.unknownShare >= 30 ? ' is-warn' : ''}`}><span>Source unknown</span><strong>{r.unknownShare}%</strong>
            <small>{r.unknown} wrote on WhatsApp with no code. Tracked links shrink this.</small></div>
        </div>
      )}

      {r?.googleAds && (r.googleAds.spend > 0 || r.googleAds.leads > 0) && (
        <section className="crm-card ls-gads">
          <h2 className="crm-h2">Google Ads</h2>
          <p className="ls-gads-line">
            <span><strong>{r.googleAds.currency === 'INR' ? rupees(r.googleAds.spend) : `${r.googleAds.spend.toLocaleString('en-IN')} ${r.googleAds.currency}`}</strong> spent</span>
            <span><strong>{r.googleAds.leads}</strong> leads{r.googleAds.perLead != null && <> · {rupees(r.googleAds.perLead)} each</>}</span>
            <span><strong>{r.googleAds.came}</strong> came to the hospital{r.googleAds.perPatient != null ? <> · <strong>{rupees(r.googleAds.perPatient)}</strong> per patient</> : null}</span>
            <span><strong>{r.googleAds.admitted}</strong> admitted</span>
          </p>
          <p className="crm-sub" style={{ margin: 0 }}>
            Spend is what Google Ads charged in this period; leads are enquiries from a Google ad click.
            {r.googleAds.sendsToAds ? ' Arrivals are sent back to Google Ads every morning, so Google learns which ads bring patients.' : ' Turn on “Tell Google Ads which clicks became patients” in Google → Setup so Google can learn which ads bring patients.'}
          </p>
        </section>
      )}

      {r && r.weeks.some((w) => w.total) && (
        <section className="crm-card">
          <h2 className="crm-h2">Leads each week</h2>
          <div className="ls-weeks" role="img" aria-label={`Leads per week for the last 12 weeks: ${r.weeks.map((w) => w.total).join(', ')}`}>
            {(() => {
              const max = Math.max(...r.weeks.map((w) => w.total), 1);
              return r.weeks.map((w) => (
                <div key={w.week} className="ls-week" title={`Week of ${weekFmt.format(new Date(w.week))}: ${w.total} leads, ${w.came} came`}>
                  <span className="ls-week-n">{w.total || ''}</span>
                  <span className="ls-week-bar" style={{ height: `${(w.total / max) * 100}%` }}>
                    <span className="ls-week-came" style={{ height: `${w.total ? (w.came / w.total) * 100 : 0}%` }} />
                  </span>
                  <span className="ls-week-l">{weekFmt.format(new Date(w.week))}</span>
                </div>
              ));
            })()}
          </div>
          <p className="ls-legend"><span className="ls-dot is-all" /> Leads <span className="ls-dot is-came" /> Came to the hospital</p>
        </section>
      )}

      {r && <Funnel title="By source" rows={r.bySource} empty="No leads in this period." />}

      <section className="crm-card is-flush">
        <div className="crm-card-head">
          <div>
            <h2 className="crm-h2">Tracked links and QR codes</h2>
            <p className="crm-sub" style={{ margin: '4px 0 0' }}>One per place: Instagram bio, Facebook page button, each hoarding, pamphlet, newspaper ad. The message carries its code, so the lead is credited here.</p>
          </div>
          {editable && <button type="button" className="crm-btn" onClick={() => setEditing('new')}><Plus size={16} aria-hidden /> New tracked link</button>}
        </div>
        {links.error && <div style={{ padding: '0 22px 16px' }}><ErrorBox message={links.error} onRetry={links.reload} /></div>}
        {!links.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={120} /></div> : links.data.items.length === 0 ? (
          <Empty title="No tracked links yet"><span className="crm-sub">Start with your Instagram bio and Facebook page button, then one for each hoarding.</span></Empty>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 820 }}>
              <thead><tr><th>Place</th><th className="num">Leads</th><th className="num">Came</th><th className="num">Cost per lead</th><th className="num">Cost per patient</th><th>Use it</th></tr></thead>
              <tbody>
                {links.data.items.map((l) => {
                  const ch = links.data!.channels.find((c) => c.code === l.channel)?.label ?? l.channel;
                  return (
                    <tr key={l.id} className={l.isActive ? '' : 'is-muted'}>
                      <td>
                        <div className="crm-cell-main">{l.name} {!l.isActive && <span className="ls-paused">paused</span>}</div>
                        <div className="crm-cell-sub"><code className="ls-code">{l.code}</code> · {ch}{l.hoarding ? ` · ${l.hoarding}` : ''}{l.cost ? ` · ${rupees(l.cost)}` : ''}</div>
                      </td>
                      <td className="num">{l.leads}</td>
                      <td className="num">{l.came}</td>
                      <td className="num">{l.cost && l.leads ? rupees(Math.round(l.cost / l.leads)) : '–'}</td>
                      <td className="num">{l.cost && l.came ? rupees(Math.round(l.cost / l.came)) : '–'}</td>
                      <td>
                        <span className="ls-actions">
                          {l.links.whatsapp ? <>
                            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(l.links.whatsapp!, 'WhatsApp link')} title={l.links.whatsapp}><Copy size={14} aria-hidden /> WhatsApp link</button>
                            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setQr({ title: l.name, sub: `Code ${l.code}`, waLink: l.links.whatsapp, message: l.links.message })}><QrCode size={14} aria-hidden /> QR poster</button>
                          </> : <span className="crm-sub">Add the WhatsApp number in WhatsApp → Account setup</span>}
                          {l.links.website && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(l.links.website!, 'Website link')} title={l.links.website}><Globe size={14} aria-hidden /> Website link</button>}
                          {editable && <button type="button" className="crm-btn is-ghost is-sm" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}><Pencil size={14} /></button>}
                          {editable && <button type="button" className="crm-btn is-ghost is-sm" aria-label={l.isActive ? `Pause ${l.name}` : `Restart ${l.name}`} onClick={() => void toggle(l)}>{l.isActive ? <Pause size={14} /> : <Play size={14} />}</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="crm-sub ls-foot">
          <Link2 size={13} aria-hidden /> WhatsApp link: put it in your Instagram bio or as the Facebook page button. QR poster: print it on hoardings, pamphlets and posters.
          Website link: for places that should open the website; its form credits the lead here. Someone who deletes the typed code before sending shows as “source unknown”.
        </p>
      </section>

      {r && r.campaigns.length > 0 && <Funnel title="Ads, forms and website campaigns" rows={r.campaigns} kindCol />}
      {r && r.byPartner.length > 0 && <Funnel title="Partners who brought leads" rows={r.byPartner} kindCol />}

      {editing && links.data && (
        <LinkEditor link={editing === 'new' ? null : editing} channels={links.data.channels} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); showToast(m); void links.reload(); void report.reload(); }} />
      )}
      {qr && <QrPosterModal info={qr} onClose={() => setQr(null)} intro={<>Print this where the {qr.title.toLowerCase()} is. Anyone who scans it lands in WhatsApp with the code <strong>{qr.sub?.replace('Code ', '')}</strong> already typed.</>} />}
      {toast}
    </main>
  );
}

/** Leads → contacted → appointment → came, for each row. */
function Funnel({ title, rows, empty, kindCol }: { title: string; rows: Row[]; empty?: string; kindCol?: boolean }) {
  const max = Math.max(...rows.map((x) => x.leads), 1);
  return (
    <section className="crm-card is-flush">
      <div className="crm-card-head"><h2 className="crm-h2">{title}</h2></div>
      {rows.length === 0 ? <Empty title={empty ?? 'Nothing yet'} /> : (
        <div className="crm-table-wrap">
          <table className="crm-table" style={{ minWidth: 720 }}>
            <thead><tr><th>{kindCol ? 'Name' : 'Source'}</th><th>Leads</th><th className="num">Contacted</th><th className="num">Appointment</th><th className="num">Came</th><th className="num">Came / leads</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key + x.label}>
                  <td><div className="crm-cell-main">{x.label}</div>{kindCol && x.key && <div className="crm-cell-sub">{x.key}</div>}</td>
                  <td><span className="ls-bar"><span style={{ width: `${(x.leads / max) * 100}%` }} /><em>{x.leads}</em></span></td>
                  <td className="num">{x.contacted}</td>
                  <td className="num">{x.appointment}</td>
                  <td className="num"><strong>{x.came}</strong></td>
                  <td className="num">{pct(x.came, x.leads)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LinkEditor({ link, channels, onClose, onSaved }: { link: LinkItem | null; channels: { code: string; label: string }[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(link?.name ?? '');
  const [channel, setChannel] = useState(link?.channel ?? 'instagram');
  const [code, setCode] = useState('');
  const [hoardingId, setHoardingId] = useState(link?.hoardingId ?? '');
  const [cost, setCost] = useState(link?.cost ? String(link.cost) : '');
  const [note, setNote] = useState(link?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoardings = useLoader(() => (channel === 'hoarding' ? crm.get<Hoarding[]>('/api/v1/lead-sources/hoardings') : Promise.resolve([] as Hoarding[])), [channel]);
  const ideas = useMemo(() => ({
    instagram: ['Instagram bio', 'Instagram story link'], facebook: ['Facebook page button', 'Facebook post'], youtube: ['YouTube description'],
    print: ['Dainik Jagran ad', 'Prabhat Khabar ad'], pamphlet: ['Pamphlet at camps', 'Chemist counter leaflet'], poster: ['Auto-rickshaw poster', 'Wall painting'],
  } as Record<string, string[]>)[channel] ?? [], [channel]);

  const pickHoarding = (id: string) => {
    setHoardingId(id);
    const h = hoardings.data?.find((x) => x.id === id);
    if (h && !name.trim()) setName(`Hoarding · ${h.place}`);
    if (h?.rent && !cost) setCost(String(Math.round(h.rent)));
  };
  const save = async () => {
    setBusy(true); setError(null);
    const body = { name, channel, hoardingId: channel === 'hoarding' && hoardingId ? hoardingId : '00000000-0000-0000-0000-000000000000', cost: cost ? Number(cost) : 0, note, ...(link ? {} : { code: code || null }) };
    try {
      if (link) await crm.put(`/api/v1/lead-sources/links/${link.id}`, body);
      else await crm.post('/api/v1/lead-sources/links', body);
      onSaved(link ? 'Saved.' : 'Tracked link made. Copy its link or print its QR poster.');
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };

  return (
    <Modal title={link ? `Edit ${link.name}` : 'New tracked link'} onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || name.trim().length < 2} onClick={() => void save()}>{busy ? 'Saving…' : link ? 'Save' : 'Make the link'}</button>
      </>}>
      <div className="ls-form">
        <label className="crm-field">Where is it?
          <select className="crm-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        {channel === 'hoarding' && (
          <label className="crm-field"><span><Signpost size={14} aria-hidden /> Which hoarding</span>
            <select className="crm-select" value={hoardingId} onChange={(e) => pickHoarding(e.target.value)}>
              <option value="">{hoardings.data?.length ? 'Pick one from your Hoardings list…' : 'No hoardings added yet'}</option>
              {hoardings.data?.map((h) => <option key={h.id} value={h.id}>{h.place}{h.block ? ` · ${h.block}` : ''}</option>)}
            </select>
          </label>
        )}
        <label className="crm-field">Name
          <input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Instagram bio" />
          {ideas.length > 0 && !name && <span className="crm-chips">{ideas.map((i) => <button key={i} type="button" className="crm-chip is-soft" onClick={() => setName(i)}>{i}</button>)}</span>}
        </label>
        {!link && (
          <label className="crm-field">Code (optional)
            <input className="crm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} maxLength={16} placeholder="Made for you, e.g. IG-BIO" />
            <span className="crm-sub" style={{ fontWeight: 400, fontSize: 12 }}>Shown in the message as “Ref: CODE”. It can&apos;t be changed later, because printed QR codes carry it.</span>
          </label>
        )}
        <label className="crm-field">What it cost, in rupees (optional)
          <input className="crm-input" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="e.g. 15000 for the hoarding's rent" />
          <span className="crm-sub" style={{ fontWeight: 400, fontSize: 12 }}>Used for cost per lead and per patient.</span>
        </label>
        <label className="crm-field">Note (optional)
          <input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. put up 1 Dec, 3 months" />
        </label>
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
