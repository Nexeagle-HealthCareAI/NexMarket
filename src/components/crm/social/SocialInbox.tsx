'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AtSign, Check, CheckCircle2, Clock, ExternalLink, Inbox, Lock, RotateCcw, Search, Send, UserPlus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents, useNow } from '@/lib/crm/live';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, initials, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { CHANNEL_LABEL, dayLabel, istDay, istTime, LEAD_LABEL, showPhone, when, type SocialStatus } from './shared';
import { place } from '@/lib/crm/access';

interface Conv {
  id: string; channel: string; name: string; username?: string | null; phone?: string | null; status: string; unread: number;
  lastMessage?: string | null; lastDirection?: string | null; lastMessageAt: string; windowOpen: boolean;
  assignedTo?: string | null; assignedName?: string | null; leadId?: string | null; leadStatus?: string | null;
}
interface ListRes { items: Conv[]; total: number; counts: { open: number; unread: number; mine: number; done: number } }
interface Msg { id: string; at: string; direction: string; type: string; text?: string | null; status: string; error?: string | null; byName?: string | null }
interface Detail {
  conversation: { id: string; channel: string; name: string; username?: string | null; phone?: string | null; status: string; unread: number; assignedTo?: string | null; assignedName?: string | null; createdAt: string };
  windowOpen: boolean; windowClosesAt?: string | null;
  lead?: { id: string; name: string; phone: string; status: string; source: string } | null;
  messages: Msg[];
}
interface Person { agentId: string; name: string }

const FILTERS = [
  { key: 'open', label: 'Open' }, { key: 'unread', label: 'Unread' }, { key: 'mine', label: 'Mine' }, { key: 'leads', label: 'Leads' }, { key: 'done', label: 'Done' }, { key: 'all', label: 'All' },
] as const;
const CHANNELS = [{ key: '', label: 'Both' }, { key: 'messenger', label: 'Facebook' }, { key: 'instagram', label: 'Instagram' }] as const;
const mins = (n: number) => (n < 60 ? `${Math.max(1, Math.round(n))} min` : `${Math.floor(n / 60)} h ${Math.round(n % 60)} min`);

/** Messages to the hospital's Facebook Page and Instagram account, with replies and "make a lead". */
export function SocialInbox({ status, selected, onSelect, onChanged, toast }: {
  status: SocialStatus | null; selected: string | null; onSelect: (id: string | null) => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [filter, setFilter] = useState<string>('open');
  const [channel, setChannel] = useState<string>('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState(0);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => new URLSearchParams({ filter, page: String(page), pageSize: '30', ...(channel ? { channel } : {}), ...(qd ? { q: qd } : {}) }).toString(), [filter, page, channel, qd]);
  const load = useCallback(async () => {
    try { setList(await crm.get<ListRes>(`/api/v1/social/conversations?${qs}`)); setError(null); }
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
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, @handle, number or message" />
            </label>
            <select className="crm-select so-channel" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Facebook or Instagram">
              {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
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
            <div style={{ padding: 16 }}><Empty title={qd ? 'No conversation matches' : 'Nothing here'}><span className="crm-sub">Messages to the {place()}&apos;s Facebook Page and Instagram account appear here as they arrive.</span></Empty></div>
          ) : (
            <ul className="ld-rows">
              {list.items.map((c) => (
                <li key={c.id}>
                  <button type="button" className="ld-row" aria-current={c.id === selected ? 'true' : undefined} onClick={() => onSelect(c.id)}>
                    <span className={`ld-av so-av is-${c.channel}`} aria-hidden>{initials(c.name)}</span>
                    <span className="ld-row-main">
                      <span className="ld-row-top"><strong>{c.name}</strong><span className={c.unread ? 'is-unread' : undefined}>{when(c.lastMessageAt)}</span></span>
                      <span className="ld-row-mid">
                        <span className="ld-preview">{c.lastDirection === 'out' ? 'You: ' : ''}{c.lastMessage ?? ''}</span>
                        {c.unread > 0 && <span className="ch-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                      </span>
                      <span className="ld-row-tags">
                        <span className={`so-chan is-${c.channel}`}>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                        {c.leadStatus && <Pill tone="accent">{LEAD_LABEL[c.leadStatus] ?? c.leadStatus}</Pill>}
                        {c.status === 'done' && <Pill tone="neutral">Done</Pill>}
                        {c.windowOpen && <span className="ld-src" title="Replies are allowed for 24 hours after their last message"><Clock size={11} aria-hidden /> Can reply</span>}
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
          {selected ? <Conversation key={selected} id={selected} ping={ping} status={status} onBack={() => onSelect(null)} onChanged={changed} toast={toast} /> : (
            <div className="ch-empty">
              <Inbox size={22} aria-hidden />
              <strong>Pick a conversation</strong>
              <span>Messages to the {place()}&apos;s Facebook Page and Instagram account. Reply within 24 hours of their message, assign it, and make it a lead once they share a number.</span>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Conversation({ id, ping, status, onBack, onChanged, toast }: {
  id: string; ping: number; status: SocialStatus | null; onBack: () => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const clock = useNow(60000);
  const enc = encodeURIComponent(id);
  const canEdit = !!status?.canManage;

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Detail>(`/api/v1/social/conversations/${enc}`);
      setD(r);
      setError(null);
      if (r.conversation.unread > 0) void crm.post(`/api/v1/social/conversations/${enc}/read`).then(onChanged).catch(() => undefined);
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
  const send = () => act(async () => { await crm.post(`/api/v1/social/conversations/${enc}/reply`, { text: text.trim() }); setText(''); });
  const patch = (body: Record<string, unknown>, ok: string) => act(() => crm.patch(`/api/v1/social/conversations/${enc}`, body), ok);

  if (error && !d) return <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={load} /></div>;
  if (!d) return <div style={{ padding: 16 }}><Skeleton h={420} /></div>;
  const c = d.conversation;
  const where = CHANNEL_LABEL[c.channel] ?? c.channel;
  const closesIn = d.windowClosesAt ? Math.max(0, (new Date(d.windowClosesAt).getTime() - clock) / 60000) : 0;

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
        <span className={`ld-av so-av is-${c.channel}`} aria-hidden>{initials(c.name)}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong className="ld-name">{c.name}</strong>
          <span className="crm-cell-sub" style={{ display: 'block' }}>
            {where}{c.username ? <> · <AtSign size={11} aria-hidden style={{ verticalAlign: '-1px' }} />{c.username}</> : null}{c.phone ? ` · ${showPhone(c.phone)}` : ''} · since {when(c.createdAt)}
          </span>
        </span>
        {canEdit && (c.status === 'open'
          ? <button type="button" className="ld-head-btn" disabled={busy} onClick={() => void patch({ status: 'done' }, 'Marked done.')} title="Nothing more to do"><CheckCircle2 size={16} aria-hidden /> <span>Done</span></button>
          : <button type="button" className="ld-head-btn" disabled={busy} onClick={() => void patch({ status: 'open' }, 'Opened again.')}><RotateCcw size={16} aria-hidden /> <span>Reopen</span></button>)}
      </header>

      <div className="ld-facts wa-facts">
        <div className="ld-fact-row">
          <label className="ld-fact">
            <span>Handled by</span>
            <select className="crm-select" value={c.assignedTo ?? ''} disabled={busy || !canEdit} onChange={(e) => void patch({ assignedTo: e.target.value }, e.target.value ? 'Assigned.' : 'Unassigned.')}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.agentId} value={p.agentId}>{p.agentId === status?.me ? `Me (${p.name})` : p.name}</option>)}
              {c.assignedTo && !people.some((p) => p.agentId === c.assignedTo) && <option value={c.assignedTo}>{c.assignedName ?? c.assignedTo}</option>}
            </select>
          </label>
          <div className="ld-fact">
            <span>Lead</span>
            {d.lead ? <Link className="wa-link" href={`/admin/leads?id=${d.lead.id}`}>{LEAD_LABEL[d.lead.status] ?? d.lead.status} →</Link>
              : canEdit ? <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => setLeadOpen(true)}><UserPlus size={14} aria-hidden /> Make a lead</button>
                : <span className="crm-sub" style={{ lineHeight: '38px' }}>Not yet</span>}
          </div>
          <div className="ld-fact">
            <span>Phone</span>
            {c.phone ? <a className="wa-link" href={`tel:+${c.phone}`}>{showPhone(c.phone)}</a> : <span className="crm-sub" style={{ lineHeight: '38px' }}>Not shared yet</span>}
          </div>
        </div>
      </div>

      <div className="ch-body ld-body" role="log" aria-live="polite" ref={bodyRef}>
        <div className="ch-secure"><Lock size={12} aria-hidden /> {where} messages to the {place()}. A phone number they write here makes them a lead automatically.</div>
        {rows.map((r, i) => 'day' in r ? <div key={`d${i}`} className="ch-day"><span>{dayLabel(r.day)}</span></div> : <Bubble key={r.id} m={r} />)}
      </div>

      <footer className="ch-compose ld-compose">
        {!status?.connected ? <div className="ld-closed"><span>Facebook isn&apos;t connected yet.</span></div>
          : !canEdit ? <div className="ld-closed"><span>You can read these messages. A marketing manager or admin can reply.</span></div>
            : d.windowOpen ? (
              <>
                <div className="ld-modes"><span className="ld-window"><Clock size={13} aria-hidden /> Reply window closes in {mins(closesIn)}</span></div>
                <div className="ch-compose-row">
                  <label className="crm-sr" htmlFor="so-input">Reply</label>
                  <textarea id="so-input" rows={1} value={text} maxLength={c.channel === 'instagram' ? 1000 : 2000} placeholder={`Reply on ${where}…`} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) void send(); } }} />
                  <button type="button" className="ch-send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}><Send size={18} /></button>
                </div>
              </>
            ) : (
              <div className="ld-closed">
                <span>More than 24 hours since they last wrote, so {where} won&apos;t deliver a reply from here. Answer in Meta Business Suite, or call them if they shared a number.</span>
                <a className="crm-btn is-secondary is-sm" href="https://business.facebook.com/latest/inbox" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> Business Suite inbox</a>
              </div>
            )}
      </footer>
      {leadOpen && <MakeLead name={c.name} phone={c.phone ?? ''} onClose={() => setLeadOpen(false)}
        onSave={async (b) => { await crm.post(`/api/v1/social/conversations/${enc}/lead`, b); setLeadOpen(false); toast('Added to the Leads inbox.'); await load(); onChanged(); }} />}
    </div>
  );
}

function MakeLead({ name, phone, onClose, onSave }: { name: string; phone: string; onClose: () => void; onSave: (b: { name: string; phone: string }) => Promise<void> }) {
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone ? phone.slice(-10) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await onSave({ name: n.trim(), phone: p }); } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title="Make a lead" onClose={onClose}
      actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || p.replace(/\D/g, '').length < 10} onClick={() => void save()}>{busy ? 'Saving…' : 'Add to Leads inbox'}</button></>}>
      <p className="crm-sub" style={{ margin: 0 }}>Ask for their mobile number in the chat, then add it here. If they&apos;re already a lead, this conversation is linked to it.</p>
      <label className="crm-field">Name<input className="crm-input" value={n} onChange={(e) => setN(e.target.value)} maxLength={120} /></label>
      <label className="crm-field">Mobile<input className="crm-input" value={p} onChange={(e) => setP(e.target.value)} inputMode="tel" placeholder="10 digits" /></label>
      {err && <div className="crm-error" role="alert">{err}</div>}
    </Modal>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === 'out';
  const failed = m.status === 'failed';
  return (
    <div className={`ch-msg${out ? ' is-mine' : ''}${failed ? ' is-failed' : ''}`}>
      <div className="ch-bubble">
        {out && <span className="ch-sender">{m.byName ?? 'From Meta inbox'}</span>}
        <span className="ch-text">{m.text}</span>
        <span className="ch-meta">
          {istTime(m.at)}
          {out && (failed ? <span className="ch-fail" title={m.error ?? undefined}>Not sent{m.error ? `: ${m.error}` : ''}</span> : <Check size={14} aria-label="Sent" />)}
        </span>
      </div>
    </div>
  );
}
