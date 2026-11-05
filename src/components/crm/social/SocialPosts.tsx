'use client';

import { useEffect, useState } from 'react';
import { Download, ExternalLink, Image as ImageIcon, Megaphone, PencilLine, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { DateRangeBar, rangeDays, rangeLabel, type DateRangeValue } from '@/components/crm/DateRange';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, Modal, Skeleton, useLoader } from '@/components/crm/ui';

interface Totals { posts: number; audience: number; engagement: number; avgEngagement: number }
interface Post {
  id: string; channel: string; channelLabel: string; source: 'synced' | 'manual' | 'broadcast'; postedAt: string; text?: string | null; mediaType?: string | null;
  permalink?: string | null; thumb?: string | null; reach?: number | null; views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null;
  saves?: number | null; clicks?: number | null; sent?: number | null; delivered?: number | null; read?: number | null; replies?: number | null; engagement: number;
  topic?: string | null; note?: string | null; metricsAt?: string | null;
}
interface PostsRes {
  summary: Totals; byChannel: { channel: string; totals: Totals }[]; byTopic: { topic: string; totals: Totals }[];
  best?: { id: string; channel: string; text?: string | null; engagement: number; postedAt: string } | null;
  topics: string[]; lastSync?: string | null; total: number; page: number; pageSize: number; items: Post[];
}

const CH: Record<string, { label: string; short: string; color: string }> = {
  facebook: { label: 'Facebook', short: 'FB', color: '#1f5fd1' },
  instagram: { label: 'Instagram', short: 'IG', color: '#c1358a' },
  whatsapp: { label: 'WhatsApp', short: 'WA', color: '#178a4c' },
};
const chKey = (c: string) => (c.startsWith('whatsapp') ? 'whatsapp' : c in CH ? c : 'other');
const n0 = (n?: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** Every post on Facebook, Instagram and WhatsApp in one list, with what each reached and how people reacted. */
export function SocialPosts({ connected, canManage, toast }: { connected: boolean; canManage: boolean; toast: (m: string) => void }) {
  const [range, setRange] = useState<DateRangeValue>({ key: '30d', from: '', to: '' });
  const [channel, setChannel] = useState('');
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const query = () => {
    const sp = new URLSearchParams(); const d = rangeDays(range);
    if (d?.from) sp.set('from', d.from); if (d?.to) sp.set('to', d.to);
    if (channel) sp.set('channel', channel); if (topic) sp.set('topic', topic); if (q) sp.set('q', q);
    return sp;
  };
  const data = useLoader(() => { const sp = query(); if (sort) sp.set('sort', sort); sp.set('page', String(page)); return crm.get<PostsRes>(`/api/v1/social/posts?${sp}`); },
    [range.key, range.from, range.to, channel, topic, q, sort, page]);
  const d = data.data;
  const reset = () => setPage(1);

  const sync = async (quiet = false) => {
    setSyncing(true);
    try {
      const r = await crm.post<{ added: number; updated: number; problems: string[] }>('/api/v1/social/posts/sync', {});
      if (!quiet || r.added) toast(r.problems.length ? `Fetched with problems: ${r.problems.join(' ')}` : `${r.added} new post${r.added === 1 ? '' : 's'} fetched; numbers updated.`);
      data.reload();
    } catch (e) { if (!quiet) toast(friendlyError(e)); } finally { setSyncing(false); }
  };
  // Fetch by itself when the list is more than 3 hours old.
  const lastSync = d?.lastSync;
  const loaded = !!d;
  useEffect(() => {
    if (!loaded || !connected || !canManage) return;
    if (lastSync && Date.now() - new Date(lastSync).getTime() <= 3 * 3600e3) return;
    const t = setTimeout(() => void sync(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, connected, canManage]);

  const exportCsv = async () => { try { await crm.download(`/api/v1/social/posts/export.csv?${query()}`, 'posts.csv'); } catch (e) { toast(friendlyError(e)); } };
  const setPostTopic = async (p: Post, t: string) => {
    try { await crm.put(`/api/v1/social/posts/${p.id}`, { ...p, topic: t || null }); data.setData((x) => x && { ...x, items: x.items.map((i) => (i.id === p.id ? { ...i, topic: t || null } : i)) }); }
    catch (e) { toast(friendlyError(e)); }
  };
  const ch = (k: string) => d?.byChannel.find((c) => c.channel === k)?.totals;

  return (
    <div className="sp">
      <div className="sp-bar">
        <DateRangeBar value={range} onChange={(r) => { setRange(r); reset(); }} id="sp-date" keys={['', '7d', '30d', 'month', 'custom']} />
        <div className="sp-actions">
          {connected && canManage && (
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void sync()} disabled={syncing}>
              <RefreshCw size={15} aria-hidden className={syncing ? 'sp-spin' : undefined} /> {syncing ? 'Fetching…' : 'Fetch from Facebook & Instagram'}
            </button>
          )}
          {canManage && <button type="button" className="crm-btn is-sm" onClick={() => setEditing('new')}><Plus size={15} aria-hidden /> Log a WhatsApp post</button>}
        </div>
      </div>
      <span className="crm-cell-sub" style={{ marginTop: -6 }}>
        {connected ? (lastSync ? `Facebook and Instagram fetched ${ago(lastSync)}. ` : 'Facebook and Instagram not fetched yet. ') : 'Facebook and Instagram aren’t connected yet, so only logged posts show. '}
        WhatsApp Status, Channel and group posts can&apos;t be read by software, so log them here; WhatsApp broadcasts sent from the CRM appear on their own.
      </span>

      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Posts · {rangeLabel(range)}</span><span className="crm-kpi-value">{d ? n0(d.summary.posts) : '–'}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">People reached</span><span className="crm-kpi-value">{d ? n0(d.summary.audience) : '–'}</span><span className="crm-kpi-sub">reach, views, or broadcast reads</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Engagement</span><span className="crm-kpi-value">{d ? n0(d.summary.engagement) : '–'}</span><span className="crm-kpi-sub">likes, comments, shares, saves, replies</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Per post</span><span className="crm-kpi-value">{d ? d.summary.avgEngagement.toLocaleString('en-IN') : '–'}</span><span className="crm-kpi-sub">average engagement</span></div>
      </div>

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="sp-ch" style={{ flexBasis: 320 }}>
          <h2 id="sp-ch" className="crm-h2">By platform</h2>
          <div className="sp-channels">
            {(['facebook', 'instagram', 'whatsapp'] as const).map((k) => {
              const t = ch(k);
              return (
                <button key={k} type="button" className="sp-channel" aria-pressed={channel === k} onClick={() => { setChannel(channel === k ? '' : k); reset(); }}>
                  <span className="sp-mark" style={{ background: CH[k].color }}>{CH[k].short}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><strong>{CH[k].label}</strong><span className="crm-cell-sub" style={{ display: 'block' }}>{t ? `${n0(t.audience)} reached · ${t.avgEngagement} per post` : 'No posts'}</span></span>
                  <strong className="sp-num">{t ? t.posts : 0}</strong>
                </button>
              );
            })}
          </div>
        </section>
        <section className="crm-card grow-2" aria-labelledby="sp-tp" style={{ flexBasis: 420 }}>
          <h2 id="sp-tp" className="crm-h2">Which topics work</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>Average engagement per post, by what the post was about. Set the topic on each post below.</span>
          {!d ? <Skeleton h={140} /> : d.byTopic.length === 0 ? <Empty title="No posts yet" /> : (
            <ul className="sp-topics">
              {d.byTopic.slice(0, 8).map((t) => {
                const max = Math.max(1, ...d.byTopic.map((x) => x.totals.avgEngagement));
                return (
                  <li key={t.topic}>
                    <button type="button" aria-pressed={topic === t.topic} onClick={() => { setTopic(topic === t.topic ? '' : t.topic); reset(); }}>
                      <span className="sp-topic-l">{t.topic === '-' ? 'No topic set' : t.topic}<span className="crm-cell-sub"> · {t.totals.posts} post{t.totals.posts === 1 ? '' : 's'}</span></span>
                      <span className="sp-topic-bar"><span style={{ width: `${Math.max(3, (t.totals.avgEngagement / max) * 100)}%` }} /></span>
                      <strong className="sp-num">{t.totals.avgEngagement}</strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="crm-card" aria-labelledby="sp-list" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="crm-card-head" style={{ padding: '16px 20px 8px', flexWrap: 'wrap', gap: 10 }}>
          <h2 id="sp-list" className="crm-h2" style={{ flex: 1 }}>All posts{d ? ` · ${d.total}` : ''}</h2>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()} disabled={!d?.total}><Download size={15} aria-hidden /> Export CSV</button>
        </div>
        <div className="crm-chips" style={{ padding: '0 20px 10px', alignItems: 'center' }}>
          {[['', 'All'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp']].map(([k, l]) => (
            <button key={k} type="button" className="crm-chip" aria-pressed={channel === k} onClick={() => { setChannel(k); reset(); }}>{l}</button>
          ))}
          {topic && <button type="button" className="crm-chip" aria-pressed="true" onClick={() => { setTopic(''); reset(); }}>{topic === '-' ? 'No topic' : topic} ×</button>}
          <label className="crm-sr" htmlFor="sp-sort">Sort</label>
          <select id="sp-sort" className="crm-select" style={{ width: 'auto' }} value={sort} onChange={(e) => { setSort(e.target.value); reset(); }}>
            <option value="">Newest first</option><option value="reach">Most reached</option><option value="engagement">Most engagement</option>
          </select>
          <label className="crm-search" style={{ flex: '1 1 200px', minWidth: 180 }}>
            <Search size={16} aria-hidden color="var(--text-2)" />
            <span className="crm-sr">Search posts</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what the post said" />
          </label>
        </div>
        {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : d.items.length === 0 ? (
          <Empty title="No posts here">{connected ? 'Fetch from Facebook & Instagram, or log a WhatsApp post.' : 'Log a WhatsApp post, or connect Facebook and Instagram in Setup.'}</Empty>
        ) : (
          <ul className="sp-posts">
            {d.items.map((p) => <PostRow key={p.id} p={p} topics={d.topics} canManage={canManage} onTopic={(t) => void setPostTopic(p, t)} onEdit={() => setEditing(p)} />)}
          </ul>
        )}
        {d && d.total > d.pageSize && <div style={{ padding: '0 20px 12px' }}><Pager page={page} pages={Math.ceil(d.total / d.pageSize)} total={d.total} size={d.pageSize} onPage={setPage} noun="posts" /></div>}
      </section>

      {editing && <PostForm post={editing === 'new' ? null : editing} topics={d?.topics ?? []} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); data.reload(); }} />}
    </div>
  );
}

function PostRow({ p, topics, canManage, onTopic, onEdit }: { p: Post; topics: string[]; canManage: boolean; onTopic: (t: string) => void; onEdit: () => void }) {
  const k = chKey(p.channel);
  const [thumbOk, setThumbOk] = useState(true);
  const stats: [string, number | null | undefined][] = p.source === 'broadcast'
    ? [['Sent', p.sent], ['Delivered', p.delivered], ['Read', p.read], ['Replies', p.replies]]
    : [['Reach', p.reach], ['Views', p.views], ['Likes', p.likes], ['Comments', p.comments], ['Shares', p.shares], ['Saves', p.saves], ['Clicks', p.clicks]];
  return (
    <li className="sp-post">
      <div className="sp-thumb">
        {/* Meta's picture links; next/image can't load them without listing every CDN host. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumb && thumbOk ? <img src={p.thumb} alt="" loading="lazy" onError={() => setThumbOk(false)} />
          : <span className="sp-thumb-ph">{p.source === 'broadcast' ? <Megaphone size={22} aria-hidden /> : <ImageIcon size={22} aria-hidden />}</span>}
        <span className="sp-mark is-small" style={{ background: CH[k]?.color ?? '#6b7280' }}>{CH[k]?.short ?? '•'}</span>
      </div>
      <div className="sp-body">
        <div className="sp-meta">
          <strong>{p.channelLabel}</strong>
          <span className="crm-cell-sub">{when(p.postedAt)}{p.mediaType ? ` · ${p.mediaType}` : ''}{p.source === 'manual' ? ' · logged by hand' : ''}</span>
        </div>
        <p className="sp-text">{p.text || <span className="crm-cell-sub">No text</span>}</p>
        <div className="sp-stats">
          {stats.filter(([, v]) => v != null).map(([l, v]) => <span key={l}><strong>{n0(v)}</strong> {l.toLowerCase()}</span>)}
          {stats.every(([, v]) => v == null) && <span className="crm-cell-sub">No numbers yet{p.source === 'manual' ? ' (edit to add views and reactions)' : ''}</span>}
        </div>
        {p.note && <span className="crm-cell-sub">Note: {p.note}</span>}
      </div>
      <div className="sp-side">
        {canManage && p.source !== 'broadcast' ? (
          <>
            <label className="crm-sr" htmlFor={`sp-t-${p.id}`}>Topic</label>
            <select id={`sp-t-${p.id}`} className="crm-select sp-topic-sel" value={p.topic ?? ''} onChange={(e) => onTopic(e.target.value)}>
              <option value="">Topic…</option>{topics.map((t) => <option key={t}>{t}</option>)}
            </select>
          </>
        ) : p.topic ? <span className="crm-chip" aria-pressed="false">{p.topic}</span> : null}
        <span className="sp-eng"><strong>{n0(p.engagement)}</strong> engagement</span>
        <span className="sp-links">
          {p.permalink && <a className="crm-btn is-ghost is-sm" href={p.permalink} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden /> Open</a>}
          {canManage && p.source !== 'broadcast' && <button type="button" className="crm-btn is-ghost is-sm" onClick={onEdit}><PencilLine size={14} aria-hidden /> {p.source === 'manual' ? 'Edit' : 'Note'}</button>}
        </span>
      </div>
    </li>
  );
}

const WA_CHANNELS = [
  { k: 'whatsapp_status', l: 'WhatsApp Status' }, { k: 'whatsapp_channel', l: 'WhatsApp Channel' }, { k: 'whatsapp_group', l: 'WhatsApp group' },
  { k: 'facebook', l: 'Facebook' }, { k: 'instagram', l: 'Instagram' }, { k: 'other', l: 'Other' },
];
const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const toLocal = (iso: string) => { const d = new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

function PostForm({ post, topics, onClose, onSaved }: { post: Post | null; topics: string[]; onClose: () => void; onSaved: (m: string) => void }) {
  const manual = !post || post.source === 'manual';
  const [f, setF] = useState({
    channel: post?.channel ?? 'whatsapp_status', postedAt: post ? toLocal(post.postedAt) : localNow(), text: post?.text ?? '', permalink: post?.permalink ?? '',
    mediaType: post?.mediaType ?? 'photo', views: post?.views?.toString() ?? '', likes: post?.likes?.toString() ?? '', comments: post?.comments?.toString() ?? '',
    shares: post?.shares?.toString() ?? '', topic: post?.topic ?? '', note: post?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s.replace(/[^\d]/g, '')) || 0)));
  const wa = f.channel.startsWith('whatsapp');
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { channel: f.channel, postedAt: new Date(f.postedAt).toISOString(), text: f.text, permalink: f.permalink, mediaType: f.mediaType,
      views: num(f.views), likes: num(f.likes), comments: num(f.comments), shares: num(f.shares), topic: f.topic || null, note: f.note };
    try {
      if (post) await crm.put(`/api/v1/social/posts/${post.id}`, body); else await crm.post('/api/v1/social/posts', body);
      onSaved(post ? 'Post updated.' : 'Post logged.');
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!post) return; setBusy(true);
    try { await crm.post(`/api/v1/social/posts/${post.id}/remove`, {}); onSaved('Post removed from the list.'); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={post ? (manual ? 'Edit post' : 'Topic and note') : 'Log a post'} onClose={onClose} actions={<>
      {post && manual && <button type="button" className="crm-btn is-ghost" onClick={() => void remove()} disabled={busy} style={{ marginRight: 'auto' }}><Trash2 size={15} aria-hidden /> Remove</button>}
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="sp-form">
        {manual && (
          <>
            <div className="sp-form-row">
              <label className="crm-field">Where
                <select className="crm-select" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{WA_CHANNELS.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}</select>
              </label>
              <label className="crm-field">When
                <input className="crm-input" type="datetime-local" value={f.postedAt} max={localNow()} onChange={(e) => setF({ ...f, postedAt: e.target.value })} />
              </label>
              <label className="crm-field">Type
                <select className="crm-select" value={f.mediaType} onChange={(e) => setF({ ...f, mediaType: e.target.value })}>
                  {['photo', 'video', 'text', 'link', 'poster', 'reel'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <label className="crm-field">What it said
              <textarea className="crm-input" rows={3} maxLength={4000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="The caption or message, e.g. Free eye check-up camp at Bahadurganj on Sunday…" />
            </label>
            <label className="crm-field">Link (optional)
              <input className="crm-input" value={f.permalink} maxLength={500} onChange={(e) => setF({ ...f, permalink: e.target.value })} placeholder={wa ? 'Channel post link, if any' : 'https://…'} />
            </label>
            <div className="sp-form-row">
              <label className="crm-field">{wa ? 'Views' : 'Reach or views'}<input className="crm-input" inputMode="numeric" value={f.views} onChange={(e) => setF({ ...f, views: e.target.value })} placeholder="e.g. 240" /></label>
              <label className="crm-field">Reactions<input className="crm-input" inputMode="numeric" value={f.likes} onChange={(e) => setF({ ...f, likes: e.target.value })} /></label>
              <label className="crm-field">Replies<input className="crm-input" inputMode="numeric" value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></label>
              <label className="crm-field">{wa ? 'Forwards' : 'Shares'}<input className="crm-input" inputMode="numeric" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} /></label>
            </div>
            {wa && <span className="crm-cell-sub">For Status, the viewer count is under the status (&ldquo;Seen by&rdquo;). You can come back and update the numbers later.</span>}
          </>
        )}
        <div className="sp-form-row">
          <label className="crm-field">Topic
            <select className="crm-select" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="">Not set</option>{topics.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <label className="crm-field" style={{ flex: 2 }}>Note
            <input className="crm-input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Boosted for ₹500; got 6 calls" />
          </label>
        </div>
        {err && <div className="crm-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}
