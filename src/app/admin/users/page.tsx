'use client';

import { useMemo, useState } from 'react';
import { Copy, KeyRound, Lock, MessageCircle, MessageSquare, Send, Smartphone, UserPlus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useAccess, type PageKey } from '@/lib/crm/access';
import { Empty, ErrorBox, fmt, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

interface RoleInfo { role: string; label: string; users: number; editable: boolean; pages: Record<PageKey, number> }
interface RolesResponse { pages: PageKey[]; roles: RoleInfo[]; fieldAgents: number }
interface Person { agentId: string; name: string; phone: string; email?: string | null; role: string; kind: 'field' | 'dashboard'; district: string; block: string; isActive: boolean; lastSignIn?: string | null; onOneTimePassword?: boolean }

const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: 'Command centre', calls: 'Daily calls', desk: 'Referral desk', pipeline: 'Referral pipeline', partners: 'Partners',
  whatsapp: 'WhatsApp broadcasts', field: 'Field force & map', payments: 'Payments', targets: 'Targets', analytics: 'Analytics & surveys',
  camps: 'Health camps', departments: 'Departments & doctors', users: 'Users & roles',
};
const HIDDEN_PAGES: PageKey[] = ['targets', 'camps']; // not built yet

const LEVELS = [
  { label: 'No access', style: { border: '1px dashed #c9cedb', background: '#fff', color: 'var(--text-2)' } },
  { label: 'Can view', style: { border: '1px solid var(--info)', background: 'var(--info-soft)', color: 'var(--info-ink)' } },
  { label: 'Can edit', style: { border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff' } },
];

const ROLE_OPTIONS = [
  { value: 'MarketingManager', label: 'Marketing manager', kind: 'dashboard' },
  { value: 'HospitalRep', label: 'Hospital representative', kind: 'dashboard' },
  { value: 'Admin', label: 'Admin (full control)', kind: 'dashboard' },
  { value: 'Marketing Executive', label: 'Field agent · Marketing executive', kind: 'field' },
  { value: 'Field Officer', label: 'Field agent · Field officer', kind: 'field' },
  { value: 'Regional Representative', label: 'Field agent · Regional representative', kind: 'field' },
];

const ROLE_TONE: Record<string, 'accent' | 'info' | 'ok' | 'warn'> = { Admin: 'accent', MarketingManager: 'info', HospitalRep: 'ok' };
const ROLE_NAME: Record<string, string> = { Admin: 'Admin', MarketingManager: 'Marketing manager', HospitalRep: 'Hospital representative' };

function tempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('') + '#7';
}

export default function UsersPage() {
  const { access } = useAccess();
  const isAdmin = !!access?.isAdmin;
  const roles = useLoader(() => crm.get<RolesResponse>('/api/v1/access/roles'));
  const people = useLoader(() => crm.get<Person[]>('/api/v1/access/people'));
  const [inviting, setInviting] = useState<'dashboard' | 'field' | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | 'dashboard' | 'field'>('all');
  const [toast, showToast] = useToast();
  const [sending, setSending] = useState<{ person: Person; password?: string } | null>(null);
  const resetPassword = async (p: Person) => {
    if (!window.confirm(`Give ${p.name} a new one-time password?\n\nTheir current password stops working and they are signed out of every device. They set their own password after signing in.`)) return;
    try {
      const r = await crm.post<{ password: string }>(`/api/v1/access/people/${encodeURIComponent(p.agentId)}/reset-password`);
      setSending({ person: p, password: r.password });
      void people.reload();
    } catch (e) { showToast(friendlyError(e)); }
  };

  const pages = (roles.data?.pages ?? []).filter((p) => !HIDDEN_PAGES.includes(p));
  const editableRoles = roles.data?.roles.filter((r) => r.editable) ?? [];

  const cycle = async (role: RoleInfo, page: PageKey) => {
    if (!isAdmin || !roles.data) return;
    const next = ((role.pages[page] ?? 0) + 1) % 3;
    const key = `${role.role}:${page}`;
    setSavingCell(key);
    const before = roles.data;
    roles.setData({ ...roles.data, roles: roles.data.roles.map((r) => (r.role === role.role ? { ...r, pages: { ...r.pages, [page]: next } } : r)) });
    try {
      await crm.put(`/api/v1/access/roles/${role.role}`, { pages: { ...role.pages, [page]: next } });
    } catch (e) {
      roles.setData(before);
      showToast(friendlyError(e));
    } finally {
      setSavingCell(null);
    }
  };

  const visiblePeople = useMemo(() => (people.data ?? []).filter((p) => kindFilter === 'all' || p.kind === kindFilter), [people.data, kindFilter]);

  const signOut = async (p: Person) => {
    try { const r = await crm.post<{ signedOutDevices: number }>(`/api/v1/access/people/${encodeURIComponent(p.agentId)}/sign-out`); showToast(`${p.name} signed out of ${r.signedOutDevices} device(s).`); }
    catch (e) { showToast(friendlyError(e)); }
  };
  const setActive = async (p: Person, value: boolean) => {
    try { await crm.post(`/api/v1/access/people/${encodeURIComponent(p.agentId)}/active?value=${value}`); showToast(value ? `${p.name} reactivated.` : `${p.name} deactivated.`); void people.reload(); }
    catch (e) { showToast(friendlyError(e)); }
  };

  return (
    <main className="crm-page">
      <PageHead title="Users & roles" sub="Decide who can open which page. Field agents only ever use the Android app.">
        <button type="button" className="crm-btn is-secondary" onClick={() => setInviting('field')}><Smartphone size={16} aria-hidden /> Onboard field agent</button>
        {isAdmin && <button type="button" className="crm-btn" onClick={() => setInviting('dashboard')}><UserPlus size={16} aria-hidden /> Invite dashboard user</button>}
      </PageHead>

      {roles.error && <ErrorBox message={roles.error} onRetry={roles.reload} />}

      <section aria-label="Roles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {!roles.data ? [0, 1, 2, 3].map((i) => <div key={i} className="crm-card"><Skeleton h={90} /></div>) : (
          <>
            {roles.data.roles.map((r) => {
              const count = pages.filter((p) => (r.pages[p] ?? 0) > 0).length;
              return (
                <RoleCard key={r.role} short={initials(r.label)} name={r.label} users={r.users} tone={ROLE_TONE[r.role] ?? 'accent'}
                  desc={r.role === 'Admin' ? 'Full control of every page, setting and user. Approves payments.'
                    : r.role === 'MarketingManager' ? 'Runs the field team, calls, broadcasts and targets.'
                    : 'Front desk and hospital staff: referral arrivals, doctor lists.'}
                  where={r.role === 'Admin' ? `All ${pages.length} pages` : `${count} of ${pages.length} pages`} />
              );
            })}
            <RoleCard short="FA" name="Field agent" users={roles.data.fieldAgents} tone="warn" desc="Onboarded here. Works only in the Android app, never this dashboard." where="Android app only" />
          </>
        )}
      </section>

      <section className="crm-card is-flush" aria-labelledby="perm-h">
        <div className="crm-card-head">
          <h2 id="perm-h" className="crm-h2">Page access</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>{isAdmin ? 'Click a cell to switch: No access → Can view → Can edit. Saved instantly.' : 'Only an admin can change access.'}</span>
        </div>
        {!roles.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={300} /></div> : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 640 }}>
              <thead>
                <tr><th scope="col">Page</th><th scope="col">Admin</th>{editableRoles.map((r) => <th key={r.role} scope="col">{r.label}</th>)}</tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 600, padding: '10px 12px 10px 22px', borderBottom: '1px solid var(--line)', textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--text)' }}>{PAGE_LABELS[p]}</th>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontSize: 13, fontWeight: 700 }}>
                        <Lock size={13} aria-hidden /> Full control
                      </span>
                    </td>
                    {editableRoles.map((r) => {
                      const level = r.pages[p] ?? 0;
                      const key = `${r.role}:${p}`;
                      return (
                        <td key={r.role}>
                          <button type="button" disabled={!isAdmin || savingCell === key} onClick={() => cycle(r, p)}
                            aria-label={`${PAGE_LABELS[p]} for ${r.label}: ${LEVELS[level].label}${isAdmin ? '. Click to change' : ''}`}
                            style={{ height: 34, minWidth: 116, padding: '0 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: isAdmin ? 'pointer' : 'default', ...LEVELS[level].style }}>
                            {LEVELS[level].label}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="crm-card is-flush" aria-labelledby="people-h">
        <div className="crm-card-head">
          <h2 id="people-h" className="crm-h2" style={{ marginRight: 'auto' }}>People</h2>
          <div className="crm-chips" role="tablist">
            {(['all', 'dashboard', 'field'] as const).map((k) => (
              <button key={k} type="button" role="tab" className="crm-chip" aria-selected={kindFilter === k} onClick={() => setKindFilter(k)}>
                {k === 'all' ? 'Everyone' : k === 'dashboard' ? 'Dashboard users' : 'Field agents'}
              </button>
            ))}
          </div>
        </div>
        {people.error && <div style={{ padding: '0 22px' }}><ErrorBox message={people.error} onRetry={people.reload} /></div>}
        {!people.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={200} /></div> : visiblePeople.length === 0 ? <Empty title="Nobody here yet" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 760 }}>
              <thead><tr><th>Person</th><th>Role</th><th>Works in</th><th>Last sign-in</th><th className="num">Actions</th></tr></thead>
              <tbody>
                {visiblePeople.map((p) => (
                  <tr key={p.agentId} style={p.isActive ? undefined : { opacity: 0.55 }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="crm-initials" style={{ background: '#e9ebf1', color: 'var(--text)' }}>{initials(p.name)}</span>
                        <div>
                          <div className="crm-cell-main">{p.name}{!p.isActive && ' (inactive)'}</div>
                          <div className="crm-cell-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span className="us-id" title="User ID">{p.agentId}</span>
                            <button type="button" className="us-copy" aria-label={`Copy user ID ${p.agentId}`} title="Copy user ID" onClick={() => { void navigator.clipboard?.writeText(p.agentId); showToast(`Copied ${p.agentId}`); }}><Copy size={12} /></button>
                            <span>{p.phone}{p.kind === 'field' && p.block ? ` · ${p.block}` : ''}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><Pill tone={p.kind === 'field' ? 'warn' : ROLE_TONE[p.role] ?? 'accent'}>{ROLE_NAME[p.role] ?? p.role}</Pill></td>
                    <td style={{ color: 'var(--text-2)' }}>{p.kind === 'field' ? 'Android app' : 'Dashboard'}</td>
                    <td style={{ color: 'var(--text-2)' }}>
                      {p.lastSignIn ? fmt.dateTime(p.lastSignIn) : 'Never'}
                      <div className="crm-cell-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={11} aria-hidden /> {p.onOneTimePassword ? <span style={{ color: 'var(--warn-ink)', fontWeight: 600 }}>One-time password, not changed yet</span> : 'Set their own password'}
                      </div>
                    </td>
                    <td className="num">
                      {isAdmin && p.agentId !== access?.agentId && (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setSending({ person: p })} title="Send their user ID"><Send size={14} aria-hidden /> Send login</button>
                          <button type="button" className="crm-btn is-sm" onClick={() => void resetPassword(p)} title="New one-time password"><KeyRound size={14} aria-hidden /> Reset &amp; send password</button>
                          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => signOut(p)}>Sign out devices</button>
                          <button type="button" className={`crm-btn is-sm ${p.isActive ? 'is-danger' : 'is-secondary'}`} onClick={() => setActive(p, !p.isActive)}>{p.isActive ? 'Deactivate' : 'Reactivate'}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {sending && <SendLogin person={sending.person} password={sending.password} onClose={() => setSending(null)} />}
      {inviting && <InviteUser kind={inviting} onClose={() => setInviting(null)} onDone={() => { void people.reload(); void roles.reload(); }} />}
      {toast}
    </main>
  );
}

function RoleCard({ short, name, users, desc, where, tone }: { short: string; name: string; users: number; desc: string; where: string; tone: 'accent' | 'info' | 'ok' | 'warn' }) {
  const bg = { accent: 'var(--accent-soft)', info: 'var(--info-soft)', ok: 'var(--ok-soft)', warn: 'var(--warn-soft)' }[tone];
  const fg = { accent: 'var(--accent-ink)', info: 'var(--info-ink)', ok: 'var(--ok-ink)', warn: 'var(--warn-ink)' }[tone];
  return (
    <div className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{short}</span>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{name}</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{users} {users === 1 ? 'person' : 'people'}</span>
        </span>
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{desc}</span>
      <span style={{ alignSelf: 'flex-start' }}><Pill tone={tone}>{where}</Pill></span>
    </div>
  );
}

function InviteUser({ kind, onClose, onDone }: { kind: 'dashboard' | 'field'; onClose: () => void; onDone: () => void }) {
  const options = ROLE_OPTIONS.filter((r) => r.kind === kind);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', role: options[0].value, district: kind === 'dashboard' ? 'Hospital' : '', block: kind === 'dashboard' ? 'Hospital' : '' });
  const [password] = useState(tempPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agentId: string; password: string } | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter first and last name.');
    if (!/^\d{10}$/.test(form.phone)) return setError('Phone must be exactly 10 digits.');
    if (!form.district.trim() || !form.block.trim()) return setError('Enter district and block.');
    setSaving(true);
    try {
      const res = await crm.post<{ agentId: string; password: string }>('/api/v1/agents', {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone, email: form.email.trim() || null,
        role: form.role, district: form.district.trim(), block: form.block.trim(), password,
      });
      setCreated({ agentId: res.agentId, password });
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return <SendLogin title="Account created" person={{ agentId: created.agentId, name: `${form.firstName} ${form.lastName}`.trim(), phone: form.phone, kind }} password={created.password} onClose={onClose} />;
  }

  return (
    <Modal title={kind === 'dashboard' ? 'Invite dashboard user' : 'Onboard field agent'} onClose={onClose} actions={
      <>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={saving} onClick={save}>{saving ? 'Creating…' : 'Create account'}</button>
      </>
    }>
      <div className="crm-form-grid">
        <label className="crm-field">First name<input className="crm-input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></label>
        <label className="crm-field">Last name<input className="crm-input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></label>
        <label className="crm-field">Mobile number<input className="crm-input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} /></label>
        <label className="crm-field">Email (optional)<input className="crm-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="crm-field">Role
          <select className="crm-select" value={form.role} onChange={(e) => set('role', e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="crm-field">District<input className="crm-input" value={form.district} onChange={(e) => set('district', e.target.value)} /></label>
        <label className="crm-field">Block<input className="crm-input" value={form.block} onChange={(e) => set('block', e.target.value)} /></label>
      </div>
      {kind === 'field' && <p className="crm-note">They sign in to the Android app with their agent ID and the one-time password, then set their own.</p>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

function loginText(p: { agentId: string; name: string; kind: 'field' | 'dashboard' }, password?: string): string {
  const where = p.kind === 'field' ? 'Open the NexMarket AI app on your phone and sign in.' : 'Sign in at the NexEagle dashboard.';
  return [
    `Namaste ${p.name.split(' ')[0] || ''}, here are your NexMarket AI login details.`,
    `User ID: ${p.agentId}`,
    password ? `One-time password: ${password}` : null,
    where,
    password ? 'You will be asked to set your own password after signing in. Please don\'t share it with anyone.' : 'Use the password you set. If you forgot it, ask your admin to reset it.',
  ].filter(Boolean).join('\n');
}

/** Send someone their user ID (and a new one-time password, when one was just made) on WhatsApp, SMS or by copying. */
function SendLogin({ person, password, onClose, title }: { person: { agentId: string; name: string; phone: string; kind: 'field' | 'dashboard' }; password?: string; onClose: () => void; title?: string }) {
  const [copied, setCopied] = useState(false);
  const text = loginText(person, password);
  const digits = (person.phone ?? '').replace(/\D/g, '');
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return (
    <Modal title={title ?? (password ? 'New one-time password' : 'Send login details')} onClose={onClose} actions={<button type="button" className="crm-btn is-secondary" onClick={onClose}>Done</button>}>
      {password && <p className="crm-note" style={{ margin: 0 }}>This password is shown only now. Send it to {person.name} privately; it stops working once they set their own.</p>}
      <pre style={{ background: 'var(--bg)', borderRadius: 12, padding: 14, fontSize: 14, whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', lineHeight: 1.5 }}>{text}</pre>
      <div className="crm-chips">
        <a className="crm-btn" style={{ background: '#1fa855', borderColor: '#1fa855' }} href={intl ? `https://wa.me/${intl}?text=${encodeURIComponent(text)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!intl}>
          <MessageCircle size={16} aria-hidden /> Send on WhatsApp
        </a>
        <a className="crm-btn is-secondary" href={intl ? `sms:+${intl}?body=${encodeURIComponent(text)}` : undefined} aria-disabled={!intl}>
          <MessageSquare size={16} aria-hidden /> Send SMS
        </a>
        <button type="button" className="crm-btn is-secondary" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); }}>
          <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {!intl && <span className="crm-cell-sub">No mobile number on file. Copy the details and send them another way.</span>}
    </Modal>
  );
}
