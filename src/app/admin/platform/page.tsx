'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Pause, Play } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, fmt, friendlyError, Modal, PageHead, Pill, Skeleton, useLoader, useToast, type Tone } from '@/components/crm/ui';

interface Org { key: string; name: string; kinds: string[]; status: string; createdAt?: string | null; first: boolean }
interface OrgList { items: Org[]; kinds: Record<string, string> }
interface Admin { agentId: string; name: string; phoneEnd: string; isActive: boolean; mustChangePassword: boolean; lastActiveAt?: string | null }
interface Detail { users: number; activeUsers: number; lastActiveAt?: string | null; admins: Admin[] }

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'ok' }, paused: { label: 'Paused', tone: 'warn' },
  setting_up: { label: 'Never finished setting up', tone: 'neutral' }, failed: { label: 'Setup failed', tone: 'bad' },
};

/** For the people who run the platform: every organisation, pause or resume, and a new password for a locked-out admin. */
export default function PlatformPage() {
  const { access } = useAccess();
  const { data, error, loading, reload } = useLoader(() => crm.get<OrgList>('/api/v1/platform/orgs'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [confirm, setConfirm] = useState<{ org: Org; to: 'active' | 'paused' } | null>(null);
  const [given, setGiven] = useState<{ name: string; agentId: string; password: string; org: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (access && !access.isPlatformOwner) return <Empty title="This page is for the people who run the platform.">Ask a NexEagle admin if you need something changed for your organisation.</Empty>;

  const setStatus = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await crm.post(`/api/v1/platform/orgs/${confirm.org.key}/status`, { status: confirm.to });
      showToast(confirm.to === 'paused' ? `${confirm.org.name} is paused.` : `${confirm.org.name} is active again.`);
      setConfirm(null);
      await reload();
    } catch (e) { showToast(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="crm-page">
      <PageHead title="Organisations" sub="Everyone using this NexEagle server. You see counts and admins only, never an organisation's patients, leads or messages." />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading || !data ? <Skeleton h={260} /> : (
        <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table" style={{ minWidth: 720 }}>
              <thead>
                <tr><th style={{ width: 36 }}><span className="crm-sr">Open</span></th><th>Organisation</th><th>Sign-in name</th><th>Type</th><th>Signed up</th><th>Status</th><th><span className="crm-sr">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.items.map((o) => {
                  const st = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as Tone };
                  const isOpen = open === o.key;
                  return [
                    <tr key={o.key}>
                      <td>
                        {!o.first && (o.status === 'active' || o.status === 'paused') && (
                          <button type="button" className="wk-icon-btn" aria-expanded={isOpen} aria-label={isOpen ? `Hide ${o.name}` : `Show people in ${o.name}`} onClick={() => setOpen(isOpen ? null : o.key)}>
                            {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                          </button>
                        )}
                      </td>
                      <td><strong>{o.name}</strong>{o.first && <span className="crm-sub"> · this one (runs the platform)</span>}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.key}</td>
                      <td>{o.kinds.map((k) => data.kinds[k] ?? k).join(', ') || '—'}</td>
                      <td>{o.createdAt ? fmt.date(o.createdAt) : '—'}</td>
                      <td><Pill tone={st.tone} dot>{st.label}</Pill></td>
                      <td style={{ textAlign: 'right' }}>
                        {!o.first && o.status === 'active' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setConfirm({ org: o, to: 'paused' })}><Pause size={14} aria-hidden /> Pause</button>}
                        {!o.first && o.status === 'paused' && <button type="button" className="crm-btn is-sm" onClick={() => setConfirm({ org: o, to: 'active' })}><Play size={14} aria-hidden /> Resume</button>}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${o.key}-detail`}>
                        <td />
                        <td colSpan={6} style={{ background: '#fbfcfe' }}><OrgDetail org={o} onGiven={setGiven} toast={showToast} /></td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirm && (
        <Modal title={confirm.to === 'paused' ? `Pause ${confirm.org.name}?` : `Resume ${confirm.org.name}?`} onClose={() => setConfirm(null)}
          actions={<><button type="button" className="crm-btn is-secondary" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="crm-btn" disabled={busy} onClick={() => void setStatus()}>{confirm.to === 'paused' ? 'Pause' : 'Resume'}</button></>}>
          {confirm.to === 'paused'
            ? <p style={{ margin: 0 }}>Nobody in this organisation will be able to sign in, and nothing will be sent for it. People already signed in are signed out within a minute. No data is removed, and you can resume it at any time.</p>
            : <p style={{ margin: 0 }}>Its people will be able to sign in again, and its reminders and messages start again.</p>}
        </Modal>
      )}
      {given && (
        <Modal title="One-time password" onClose={() => setGiven(null)} actions={<button type="button" className="crm-btn" onClick={() => setGiven(null)}>Done</button>}>
          <p style={{ marginTop: 0 }}>Give this to <strong>{given.name}</strong> ({given.agentId}, {given.org}) by phone. It is shown only once, and they must choose a new password when they sign in.</p>
          <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.04em', margin: '8px 0', userSelect: 'all', fontVariantNumeric: 'tabular-nums' }}>{given.password}</p>
          <p className="crm-sub" style={{ marginBottom: 0 }}>All their devices have been signed out. This reset is written in their organisation&rsquo;s own activity log.</p>
        </Modal>
      )}
      {toast}
    </div>
  );
}

function OrgDetail({ org, onGiven, toast }: { org: Org; onGiven: (g: { name: string; agentId: string; password: string; org: string }) => void; toast: (m: string) => void }) {
  const { data, error, loading, reload } = useLoader(() => crm.get<Detail>(`/api/v1/platform/orgs/${org.key}`), [org.key]);
  const [asking, setAsking] = useState<Admin | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Skeleton h={80} />;
  const reset = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      const r = await crm.post<{ agentId: string; name: string; password: string }>(`/api/v1/platform/orgs/${org.key}/admins/${encodeURIComponent(asking.agentId)}/reset-password`);
      setAsking(null);
      onGiven({ ...r, org: org.name });
      await reload();
    } catch (e) { toast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 0' }}>
      <span className="crm-sub">{data.activeUsers} active {data.activeUsers === 1 ? 'person' : 'people'} of {data.users} · last active {data.lastActiveAt ? fmt.dateTime(data.lastActiveAt) : 'never'}</span>
      {data.admins.length === 0 ? <span className="crm-sub">This organisation has no admin.</span> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.admins.map((a) => (
            <li key={a.agentId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 220px', minWidth: 0 }}><strong>{a.name}</strong> <span className="crm-sub">· admin · {a.agentId}{a.phoneEnd ? ` · phone ${a.phoneEnd}` : ''}{!a.isActive ? ' · switched off' : ''}{a.mustChangePassword ? ' · has a one-time password' : ''}</span></span>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setAsking(a)}><KeyRound size={14} aria-hidden /> New one-time password</button>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <Modal title={`New password for ${asking.name}?`} onClose={() => setAsking(null)}
          actions={<><button type="button" className="crm-btn is-secondary" onClick={() => setAsking(null)}>Cancel</button><button type="button" className="crm-btn" disabled={busy} onClick={() => void reset()}>Make a one-time password</button></>}>
          <p style={{ margin: 0 }}>Do this only when {asking.name} has asked you and you are sure it is them: call back the number ending {asking.phoneEnd || '(none saved)'}. Their current password stops working at once and all their devices are signed out.</p>
        </Modal>
      )}
    </div>
  );
}
