'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Plus, ShieldCheck, UserMinus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { errText, NATURE, PALETTE, rs, type Balance, type Data, type Kind, type Nature } from './shared';

interface ManagerRow { agentId: string; name: string; active: boolean; note?: string | null; balance: Balance }

/** One kind of spend, editable in place: name, constant or variable, colour, phone app, archive. */
function KindRow({ k, canEdit, onSave }: { k: Kind; canEdit: boolean; onSave: (key: string, body: Partial<Kind>) => Promise<boolean> }) {
  const [label, setLabel] = useState(k.label);
  const [pick, setPick] = useState(false);
  const fixed = k.key === 'agents' || k.key === 'other';
  return (
    <li className={`mk-row${k.archived ? ' is-archived' : ''}`}>
      <span className="mk-color-wrap">
        <button type="button" className="mk-color" style={{ background: k.color }} aria-label={`Colour of ${k.label}`} aria-expanded={pick} disabled={!canEdit} onClick={() => setPick((v) => !v)} />
        {pick && (
          <span className="mk-palette" role="group" aria-label="Pick a colour">
            {PALETTE.map((c) => <button key={c} type="button" className="mp-color" aria-label={c} aria-pressed={k.color === c} style={{ background: c }} onClick={() => { setPick(false); void onSave(k.key, { color: c }); }} />)}
          </span>
        )}
      </span>
      <label className="crm-sr" htmlFor={`mk-${k.key}`}>Name</label>
      <input id={`mk-${k.key}`} className="crm-input mk-name" value={label} maxLength={40} disabled={!canEdit || k.archived}
        onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (label.trim() && label.trim() !== k.label) void onSave(k.key, { label: label.trim() }).then((ok) => { if (!ok) setLabel(k.label); }); else setLabel(k.label); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="mk-seg" role="group" aria-label={`${k.label}: constant or variable`}>
        {(['constant', 'variable'] as Nature[]).map((n) => (
          <button key={n} type="button" aria-pressed={k.nature === n} disabled={!canEdit || k.archived || k.key === 'agents'} onClick={() => void onSave(k.key, { nature: n })}>{NATURE[n].label}</button>
        ))}
      </span>
      <label className="mk-app" title="Agents can pick it when they add an expense from the phone">
        <input type="checkbox" checked={k.agentCanUse && k.key !== 'agents'} disabled={!canEdit || k.archived || k.key === 'agents'} onChange={(e) => void onSave(k.key, { agentCanUse: e.target.checked })} /> In the app
      </label>
      {canEdit && !fixed && (
        <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void onSave(k.key, { archived: !k.archived })}>
          {k.archived ? <><ArchiveRestore size={14} aria-hidden /> Bring back</> : <><Archive size={14} aria-hidden /> Archive</>}
        </button>
      )}
      {fixed && <span className="crm-sub mk-fixed">Always there</span>}
    </li>
  );
}

/**
 * Setup: the team's own kinds of spend (each constant or variable, with a colour, and whether agents can pick it in the
 * app), and the money managers who hold the marketing funds and hand them out.
 */
export function SetupTab({ data, toast, onChanged }: { data: Data; toast: (m: string) => void; onChanged: () => void }) {
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [mgrs, setMgrs] = useState<ManagerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Nature | null>(null);
  const [addMgr, setAddMgr] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const canEdit = data.me.canHandle;
  const load = useCallback(async () => {
    try {
      const [k, m] = await Promise.all([crm.get<Kind[]>('/api/v1/spend/kinds'), crm.get<ManagerRow[]>('/api/v1/spend/managers')]);
      setKinds(k); setMgrs(m); setErr(null);
    } catch (e) { setErr(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const save = async (key: string, body: Partial<Kind>) => {
    try { await crm.put(`/api/v1/spend/kinds/${encodeURIComponent(key)}`, body); await load(); onChanged(); return true; } catch (e) { toast(errText(e)); return false; }
  };
  const removeMgr = async (m: ManagerRow) => {
    if (!window.confirm(`Stop ${m.name} being a money manager? ${m.balance.holds ? `They still hold ${rs(m.balance.holds)}; it stays in their balance until they hand it back.` : ''}`)) return;
    try { await crm.post(`/api/v1/spend/managers/${encodeURIComponent(m.agentId)}/remove`); toast(`${m.name} is no longer a money manager.`); await load(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  if (err && !kinds) return <ErrorBox message={err} onRetry={load} />;
  if (!kinds || !mgrs) return <Skeleton h={300} />;
  const list = (n: Nature) => kinds.filter((k) => k.nature === n && (showArchived || !k.archived));
  const active = mgrs.filter((m) => m.active);

  return (
    <>
      <section className="crm-card so-card" aria-labelledby="mk-mgr-h">
        <div className="ma-card-h">
          <h2 id="mk-mgr-h" className="crm-h2" style={{ margin: 0 }}><ShieldCheck size={18} aria-hidden /> Money managers</h2>
          {data.me.canSetup && <button type="button" className="crm-btn is-sm" onClick={() => setAddMgr(true)}><Plus size={15} aria-hidden /> Add money manager</button>}
        </div>
        <p className="crm-sub" style={{ margin: 0 }}>A money manager (usually the marketing manager) receives the marketing funds and hands money out to the team. They can record funds received, give or take back money, approve expenses, pay salaries and constant payments, and set up projects and kinds, even with view-only access to Payments. What they hand out comes out of what they hold.</p>
        {active.length === 0 ? <Empty title="No money manager yet"><span className="crm-sub">Until there is one, only people who can edit Payments handle the money.</span></Empty> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Manager</th><th scope="col" className="wb-num">Received</th><th scope="col" className="wb-num">Given to them</th><th scope="col" className="wb-num">Handed to the team</th><th scope="col" className="wb-num">Spent</th><th scope="col">Holds now</th>{data.me.canSetup && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
              <tbody>
                {active.map((m) => (
                  <tr key={m.agentId}>
                    <td><strong>{m.name}</strong><span className="crm-cell-sub" style={{ display: 'block' }}>{m.agentId}{m.note ? ` · ${m.note}` : ''}</span></td>
                    <td className="wb-num">{rs(m.balance.received)}</td>
                    <td className="wb-num">{rs(m.balance.given)}</td>
                    <td className="wb-num">{rs((m.balance.handedOut ?? 0) - (m.balance.handedBack ?? 0))}</td>
                    <td className="wb-num">{rs(m.balance.spent)}</td>
                    <td>{m.balance.net > 0 ? <Pill tone="info">{rs(m.balance.holds)}</Pill> : m.balance.net < 0 ? <Pill tone="bad">We owe {rs(m.balance.owed)}</Pill> : <Pill tone="ok">Nothing</Pill>}</td>
                    {data.me.canSetup && <td className="wb-num"><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void removeMgr(m)}><UserMinus size={14} aria-hidden /> Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="crm-card so-card" aria-labelledby="mk-kinds-h">
        <div className="ma-card-h">
          <h2 id="mk-kinds-h" className="crm-h2" style={{ margin: 0 }}>Kinds of spend</h2>
          <label className="mk-app"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({kinds.filter((k) => k.archived).length})</label>
        </div>
        <p className="crm-sub" style={{ margin: 0 }}>Make the kinds your team needs and mark each one constant or variable; Analytics adds them up that way. Renaming or changing a kind changes it on old entries too. Archived kinds stay on old entries but can&apos;t be picked for new ones.</p>
        <div className="mk-groups">
          {(['constant', 'variable'] as Nature[]).map((n) => (
            <div key={n}>
              <h3 className="ma-h3"><i style={{ background: NATURE[n].color }} aria-hidden />{NATURE[n].label} <span className="crm-sub" style={{ fontWeight: 400 }}>{NATURE[n].hint}</span></h3>
              <ul className="mk-list">{list(n).map((k) => <KindRow key={`${k.key}${k.label}${k.nature}${k.color}${k.archived}${k.agentCanUse}`} k={k} canEdit={canEdit} onSave={save} />)}</ul>
              {canEdit && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setAdding(n)}><Plus size={14} aria-hidden /> New {n} kind</button>}
            </div>
          ))}
        </div>
      </section>
      {adding && <KindForm nature={adding} onClose={() => setAdding(null)} onSaved={(m) => { toast(m); setAdding(null); void load(); onChanged(); }} />}
      {addMgr && <ManagerForm data={data} taken={active.map((m) => m.agentId)} onClose={() => setAddMgr(false)} onSaved={(m) => { toast(m); setAddMgr(false); void load(); onChanged(); }} />}
    </>
  );
}

function KindForm({ nature: start, onClose, onSaved }: { nature: Nature; onClose: () => void; onSaved: (m: string) => void }) {
  const [label, setLabel] = useState('');
  const [nature, setNature] = useState<Nature>(start);
  const [color, setColor] = useState('');
  const [app, setApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!label.trim()) { setErr('Write a name for it.'); return; }
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/spend/kinds', { label, nature, color: color || null, agentCanUse: app }); onSaved(`“${label.trim()}” added as a ${nature} kind.`); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="New kind of spend" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
    </>}>
      <div className="ms-form">
        <label className="crm-field">Name<input className="crm-input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Software, Printing, Travel" /></label>
        <fieldset className="ms-set"><legend>Constant or variable</legend>
          <div className="crm-chips">{(['constant', 'variable'] as Nature[]).map((n) => <button key={n} type="button" className="crm-chip" aria-pressed={nature === n} onClick={() => setNature(n)}>{NATURE[n].label}</button>)}</div>
          <p className="crm-sub" style={{ margin: '8px 0 0' }}>{NATURE[nature].hint}</p>
        </fieldset>
        <fieldset className="ms-set"><legend>Colour</legend>
          <div className="mp-colors">{PALETTE.map((c) => <button key={c} type="button" className="mp-color" aria-label={c} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
        </fieldset>
        <label className="mk-app"><input type="checkbox" checked={app} onChange={(e) => setApp(e.target.checked)} /> Agents can pick it in the app</label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function ManagerForm({ data, taken, onClose, onSaved }: { data: Data; taken: string[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [agentId, setAgentId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!agentId) { setErr('Pick the person.'); return; }
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/spend/managers', { agentId, note }); onSaved(`${data.staff.find((s) => s.agentId === agentId)?.name ?? agentId} is now a money manager. They are told.`); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a money manager" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
    </>}>
      <div className="ms-form">
        <label className="crm-field">Person
          <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Pick a person</option>
            {data.staff.filter((s) => !taken.includes(s.agentId)).map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.role}</option>)}
          </select>
          <span className="crm-sub" style={{ fontWeight: 400 }}>They also need to be able to open Payments (view is enough). Set that in Users &amp; roles.</span>
        </label>
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Marketing manager, Purnia" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
