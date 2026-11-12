'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Ban, Check, CheckCheck, CheckCircle2, Clock, FileText, Inbox, Lock, MessageSquarePlus, Phone, PhoneCall, RotateCcw, Search, Send, UserPlus, Users,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents, useNow } from '@/lib/crm/live';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, initials, Pill, Skeleton } from '@/components/crm/ui';
import { dayLabel, istDay, istTime, showPhone, sourceLabel, TemplateSender, when, type WaStatus } from './shared';
import { place } from '@/lib/crm/access';

interface Conv {
  phone: string; name: string; status: string; unread: number; optOut: boolean; lastMessage?: string | null; lastDirection?: string | null;
  lastMessageAt: string; windowOpen: boolean; assignedTo?: string | null; assignedName?: string | null;
  leadId?: string | null; leadStatus?: string | null; partnerClientId?: string | null; partnerName?: string | null;
}
interface ListRes { items: Conv[]; total: number; counts: { open: number; unread: number; mine: number; unassigned: number; done: number } }
interface Msg { id: string; at: string; direction: string; type: string; text: string; status: string; error?: string | null; source: string; template?: string | null; byName?: string | null; broadcast?: string | null }
interface Detail {
  conversation: { phone: string; name: string; status: string; unread: number; optOut: boolean; assignedTo?: string | null; assignedName?: string | null; lastInboundAt?: string | null; createdAt: string };
  windowOpen: boolean; windowClosesAt?: string | null;
  lead?: { id: string; name: string; status: string; ownerId?: string | null; source: string; department?: string | null } | null;
  partner?: { clientId: string; name: string; role: string } | null;
  messages: Msg[];
}
interface Person { agentId: string; name: string; open: number }

const FILTERS = [
  { key: 'open', label: 'Open' }, { key: 'unread', label: 'Unread' }, { key: 'mine', label: 'Mine' }, { key: 'unassigned', label: 'Nobody’s' },
  { key: 'leads', label: 'Leads' }, { key: 'partners', label: 'Partners' }, { key: 'done', label: 'Done' }, { key: 'all', label: 'All' },
] as const;
const LEAD_LABEL: Record<string, string> = { new: 'New lead', contacted: 'Contacted', appointment: 'Appointment', arrived: 'Arrived', admitted: 'Admitted', lost: 'Not interested' };
const mins = (n: number) => (n < 60 ? `${Math.max(1, Math.round(n))} min` : `${Math.floor(n / 60)} h ${Math.round(n % 60)} min`);

export function WaInbox({ status, selected, onSelect, onChanged, toast }: {
  status: WaStatus | null; selected: string | null; onSelect: (phone: string | null) => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [filter, setFilter] = useState<string>('open');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState(0);
  const [starting, setStarting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => new URLSearchParams({ filter, page: String(page), pageSize: '30', ...(qd ? { q: qd } : {}) }).toString(), [filter, page, qd]);
  const load = useCallback(async () => {
    try { setList(await crm.get<ListRes>(`/api/v1/whatsapp/conversations?${qs}`)); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  const onEvent = useCallback((e: { kind: string }) => { if (e.kind === 'lead') { void load(); setPing((n) => n + 1); } }, [load]);
  useLiveEvents(onEvent);
  const changed = useCallback(() => { void load(); onChanged(); }, [load, onChanged]);

  return (
    <>
      {error && <ErrorBox message={error} onRetry={load} />}
      <div className={`ld-shell wa-shell${selected ? ' has-sel' : ''}`}>
        <aside className="ld-list" aria-label="Conversations">
          <div className="ld-filters">
            <label className="ch-search" style={{ margin: 0 }}>
              <Search size={16} aria-hidden />
              <span className="crm-sr">Search conversations</span>
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, number or message" />
            </label>
            <button type="button" className="crm-btn is-sm" onClick={() => setStarting(true)} title="Message someone new"><MessageSquarePlus size={15} aria-hidden /> New</button>
          </div>
          <div className="crm-chips wa-filters" role="tablist">
            {FILTERS.map((f) => {
              const n = list ? (list.counts as Record<string, number>)[f.key] : undefined;
              return (
                <button key={f.key} type="button" role="tab" className="crm-chip" aria-selected={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}>
                  {f.label}{n ? <span className="ld-chip-n">{n}</span> : null}
                </button>
              );
            })}
          </div>
          {!list ? <div style={{ padding: 12 }}><Skeleton h={320} /></div> : list.items.length === 0 ? (
            <div style={{ padding: 16 }}><Empty title={qd ? 'No conversation matches' : 'Nothing here'}><span className="crm-sub">Messages to the {place()}&apos;s WhatsApp number appear here as they arrive.</span></Empty></div>
          ) : (
            <ul className="ld-rows">
              {list.items.map((c) => (
                <li key={c.phone}>
                  <button type="button" className="ld-row" aria-current={c.phone === selected ? 'true' : undefined} onClick={() => onSelect(c.phone)}>
                    <span className={`ld-av ${c.partnerClientId ? 'src-partner' : c.leadId ? 'src-whatsapp' : 'src-desk'}`} aria-hidden>{c.name.startsWith('+') ? <Phone size={16} /> : initials(c.name.replace(/\([^)]*\)/g, '').trim() || c.name)}</span>
                    <span className="ld-row-main">
                      <span className="ld-row-top"><strong>{c.name}</strong><span className={c.unread ? 'is-unread' : undefined}>{when(c.lastMessageAt)}</span></span>
                      <span className="ld-row-mid">
                        <span className="ld-preview">{c.lastMessage ?? ''}</span>
                        {c.unread > 0 && <span className="ch-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                      </span>
                      <span className="ld-row-tags">
                        {c.leadStatus && <Pill tone="accent">{LEAD_LABEL[c.leadStatus] ?? c.leadStatus}</Pill>}
                        {c.partnerName && <Pill tone="info">Partner</Pill>}
                        {c.optOut && <Pill tone="bad">Opted out</Pill>}
                        {c.status === 'done' && <Pill tone="neutral">Done</Pill>}
                        {c.windowOpen && <span className="ld-src" title="WhatsApp allows free replies for 24 hours after their last message"><Clock size={11} aria-hidden /> Can reply</span>}
                        <span className="ld-owner">{c.assignedName ?? 'Nobody yet'}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list && <Pager page={page} pages={Math.max(1, Math.ceil(list.total / 30))} total={list.total} size={30} onPage={setPage} noun="conversations" compact />}
        </aside>
        <section className="ld-pane" aria-label="Conversation">
          {selected ? <Conversation key={selected} phone={selected} ping={ping} status={status} onBack={() => onSelect(null)} onChanged={changed} toast={toast} /> : (
            <div className="ch-empty">
              <Inbox size={22} aria-hidden />
              <strong>Pick a conversation</strong>
              <span>Every message to the {place()}&apos;s WhatsApp number: patients, partners and anyone else. Reply, assign it to someone, or turn it into a lead.</span>
            </div>
          )}
        </section>
      </div>
      {starting && (
        <TemplateSender title="Message someone new" askPhone onClose={() => setStarting(false)}
          onSend={async (b) => {
            const r = await crm.post<{ phone: string }>('/api/v1/whatsapp/conversations', { phone: b.phone, name: b.name, template: b.template, language: b.language, values: b.values, preview: b.preview });
            setStarting(false); toast('Sent.'); changed(); onSelect(r.phone);
          }} />
      )}
    </>
  );
}

function Conversation({ phone, ping, status, onBack, onChanged, toast }: {
  phone: string; ping: number; status: WaStatus | null; onBack: () => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const clock = useNow(60000);
  const enc = encodeURIComponent(phone);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Detail>(`/api/v1/whatsapp/conversations/${enc}`);
      setD(r);
      setError(null);
      if (r.conversation.unread > 0) void crm.post(`/api/v1/whatsapp/conversations/${enc}/read`).then(onChanged).catch(() => undefined);
    } catch (e) { setError(friendlyError(e)); }
  }, [enc, onChanged]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 8000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  useEffect(() => { if (ping) { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); } }, [ping, load]);
  useEffect(() => { crm.get<Person[]>('/api/v1/leads/people').then(setPeople).catch(() => undefined); }, []);
  useEffect(() => {
    const n = d?.messages.length ?? 0;
    if (n !== count.current) { count.current = n; const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }
  }, [d]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); if (ok) toast(ok); } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  const send = () => act(async () => { await crm.post(`/api/v1/whatsapp/conversations/${enc}/text`, { text: text.trim() }); setText(''); });
  const patch = (body: Record<string, unknown>, ok: string) => act(() => crm.patch(`/api/v1/whatsapp/conversations/${enc}`, body), ok);

  if (error && !d) return <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={load} /></div>;
  if (!d) return <div style={{ padding: 16 }}><Skeleton h={420} /></div>;
  const c = d.conversation;
  const closesIn = d.windowClosesAt ? Math.max(0, (new Date(d.windowClosesAt).getTime() - clock) / 60000) : 0;
  const blocked = !status?.connected ? 'WhatsApp isn’t connected yet.' : status.paused ? 'Sending is paused for everyone (WhatsApp → Automation).' : c.optOut ? 'They asked not to get WhatsApp messages.' : null;

  const rows: ({ day: string } | Msg)[] = [];
  let last = '';
  for (const m of d.messages) {
    const day = istDay(m.at);
    if (day !== last) { rows.push({ day: m.at }); last = day; }
    rows.push(m);
  }

  return (
    <div className="ch-conv">
      <header className="ch-head ld-head">
        <button type="button" className="ch-icon ch-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
        <span className={`ld-av ${d.partner ? 'src-partner' : d.lead ? 'src-whatsapp' : 'src-desk'}`} aria-hidden>{c.name.startsWith('+') ? <Phone size={16} /> : initials(c.name.replace(/\([^)]*\)/g, '').trim() || c.name)}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong className="ld-name">{c.name}</strong>
          <span className="crm-cell-sub" style={{ display: 'block' }}>{showPhone(c.phone)} · since {when(c.createdAt)}</span>
        </span>
        <a className="ld-head-btn" href={`tel:+${c.phone}`} title="Call"><PhoneCall size={16} aria-hidden /> <span>Call</span></a>
        {c.status === 'open'
          ? <button type="button" className="ld-head-btn" disabled={busy} onClick={() => void patch({ status: 'done' }, 'Marked done.')} title="Nothing more to do"><CheckCircle2 size={16} aria-hidden /> <span>Done</span></button>
          : <button type="button" className="ld-head-btn" disabled={busy} onClick={() => void patch({ status: 'open' }, 'Opened again.')}><RotateCcw size={16} aria-hidden /> <span>Reopen</span></button>}
      </header>

      <div className="ld-facts wa-facts">
        <div className="ld-fact-row">
          <label className="ld-fact">
            <span>Handled by</span>
            <select className="crm-select" value={c.assignedTo ?? ''} disabled={busy} onChange={(e) => void patch({ assignedTo: e.target.value }, e.target.value ? 'Assigned.' : 'Unassigned.')}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.agentId} value={p.agentId}>{p.agentId === status?.me ? `Me (${p.name})` : p.name}</option>)}
              {c.assignedTo && !people.some((p) => p.agentId === c.assignedTo) && <option value={c.assignedTo}>{c.assignedName ?? c.assignedTo}</option>}
            </select>
          </label>
          <div className="ld-fact">
            <span>Lead</span>
            {d.lead ? <Link className="wa-link" href={`/admin/leads?id=${d.lead.id}`}>{LEAD_LABEL[d.lead.status] ?? d.lead.status} →</Link>
              : <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => void act(() => crm.post(`/api/v1/whatsapp/conversations/${enc}/lead`), 'Added to the Leads inbox.')}><UserPlus size={14} aria-hidden /> Make a lead</button>}
          </div>
          <div className="ld-fact">
            <span>Partner</span>
            {d.partner ? <Link className="wa-link is-partner" href={`/admin/partners?id=${encodeURIComponent(d.partner.clientId)}`}><Users size={13} aria-hidden /> {d.partner.name}</Link> : <span className="crm-sub" style={{ lineHeight: '38px' }}>Not a partner</span>}
          </div>
          <div className="ld-fact">
            <span>Messages</span>
            {c.optOut
              ? <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => void patch({ optOut: false }, 'They can get messages again.')}>Allow again</button>
              : <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => void patch({ optOut: true }, 'No more WhatsApp messages to them.')}><Ban size={14} aria-hidden /> Stop messages</button>}
          </div>
        </div>
      </div>

      <div className="ch-body ld-body" role="log" aria-live="polite" ref={bodyRef}>
        <div className="ch-secure"><Lock size={12} aria-hidden /> Messages with the {place()}&apos;s WhatsApp number. Everyone on the desk can see this conversation.</div>
        {rows.map((r, i) => 'day' in r ? <div key={`d${i}`} className="ch-day"><span>{dayLabel(r.day)}</span></div> : <Bubble key={r.id} m={r} />)}
      </div>

      <footer className="ch-compose ld-compose">
        {blocked ? <div className="ld-closed"><span>{blocked}</span></div>
          : d.windowOpen ? (
            <>
              <div className="ld-modes"><span className="ld-window"><Clock size={13} aria-hidden /> Reply window closes in {mins(closesIn)}</span>
                <button type="button" className="nt-link" style={{ marginLeft: 8 }} onClick={() => setTplOpen(true)}><FileText size={13} aria-hidden /> Template</button></div>
              <div className="ch-compose-row">
                <label className="crm-sr" htmlFor="wa-input">Reply</label>
                <textarea id="wa-input" rows={1} value={text} maxLength={4000} placeholder="Reply on WhatsApp…" onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) void send(); } }} />
                <button type="button" className="ch-send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}><Send size={18} /></button>
              </div>
            </>
          ) : (
            <div className="ld-closed">
              <span>More than 24 hours since they last wrote, so WhatsApp only allows an approved template. When they reply, you can chat freely again.</span>
              <button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => setTplOpen(true)}><FileText size={15} aria-hidden /> Send a template</button>
            </div>
          )}
      </footer>
      {tplOpen && (
        <TemplateSender title={`Template to ${c.name}`} defaultName={c.name.startsWith('+') ? undefined : c.name.split(' ')[0]} onClose={() => setTplOpen(false)}
          onSend={async (b) => {
            await crm.post(`/api/v1/whatsapp/conversations/${enc}/template`, { template: b.template, language: b.language, values: b.values, preview: b.preview });
            setTplOpen(false); toast('Sent.'); await load(); onChanged();
          }} />
      )}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === 'out';
  const failed = m.status === 'failed' || m.status === 'blocked';
  return (
    <div className={`ch-msg${out ? ' is-mine' : ''}${failed ? ' is-failed' : ''}${m.source === 'broadcast' ? ' is-broadcast' : ''}`}>
      <div className="ch-bubble">
        {out && <span className="ch-sender">{m.source === 'broadcast' ? `Broadcast${m.broadcast ? `: ${m.broadcast}` : ''}` : m.byName ?? sourceLabel(m.source)}{m.template ? ` · ${m.template}` : ''}</span>}
        {!out && m.type !== 'text' && m.type !== 'button' && <span className="ld-media"><FileText size={13} aria-hidden /> They sent {m.type === 'image' ? 'a photo' : m.type === 'audio' ? 'a voice message' : m.type === 'document' ? 'a document' : m.type === 'location' ? 'a location' : 'something'}.</span>}
        <span className="ch-text">{m.text}</span>
        <span className="ch-meta">
          {istTime.format(new Date(m.at))}
          {out && (failed ? <span className="ch-fail" title={m.error ?? undefined}>{m.status === 'blocked' ? 'Not sent' : 'Not delivered'}{m.error ? `: ${m.error}` : ''}</span>
            : m.status === 'read' ? <CheckCheck size={15} aria-label="Read" className="is-read" />
              : m.status === 'delivered' ? <CheckCheck size={15} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
        </span>
      </div>
    </div>
  );
}
