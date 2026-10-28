'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

interface Department { id: string; name: string; isActive: boolean; order: number }
interface Doctor { id: string; name: string; departmentId?: string | null; department?: string | null; qualification?: string | null; opdDays?: string | null; opdTimings?: string | null; isActive: boolean }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DepartmentsPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'departments');
  const depts = useLoader(() => crm.get<Department[]>('/api/v1/departments?includeInactive=true'));
  const doctors = useLoader(() => crm.get<Doctor[]>('/api/v1/doctors?includeInactive=true'));
  const [editDept, setEditDept] = useState<Department | 'new' | null>(null);
  const [editDoc, setEditDoc] = useState<Doctor | 'new' | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [toast, showToast] = useToast();

  const list = (doctors.data ?? []).filter((d) => !deptFilter || d.departmentId === deptFilter);

  return (
    <main className="crm-page">
      <PageHead title="Departments & doctors" sub="Glisan Akbari's departments and doctors. Field agents pick from these when referring, and WhatsApp broadcasts use them for OPD updates." />

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="dept-h">
          <div className="crm-card-head">
            <h2 id="dept-h" className="crm-h2" style={{ marginRight: 'auto' }}>Departments</h2>
            {editable && <button type="button" className="crm-btn is-sm" onClick={() => setEditDept('new')}><Plus size={14} aria-hidden /> Add</button>}
          </div>
          {depts.error && <ErrorBox message={depts.error} onRetry={depts.reload} />}
          {!depts.data ? <Skeleton h={200} /> : depts.data.length === 0 ? <Empty title="No departments yet">{editable ? 'Add the hospital’s departments to get started.' : ''}</Empty> : (
            <ul className="crm-list">
              <li style={{ padding: 0 }}>
                <button type="button" className="crm-chip" aria-pressed={!deptFilter} onClick={() => setDeptFilter('')} style={{ margin: '8px 0' }}>All doctors</button>
              </li>
              {depts.data.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setDeptFilter(deptFilter === d.id ? '' : d.id)} aria-pressed={deptFilter === d.id}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: deptFilter === d.id ? 'var(--accent-ink)' : 'var(--text)' }}>{d.name}</span>
                    <span className="crm-cell-sub">{(doctors.data ?? []).filter((x) => x.departmentId === d.id && x.isActive).length} doctors</span>
                  </button>
                  {!d.isActive && <Pill>Hidden</Pill>}
                  {editable && <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Edit ${d.name}`} onClick={() => setEditDept(d)} style={{ width: 36, padding: 0 }}><Pencil size={14} aria-hidden /></button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="crm-card is-flush grow-2" aria-labelledby="doc-h">
          <div className="crm-card-head">
            <h2 id="doc-h" className="crm-h2" style={{ marginRight: 'auto' }}>Doctors</h2>
            {editable && <button type="button" className="crm-btn is-sm" onClick={() => setEditDoc('new')}><Plus size={14} aria-hidden /> Add doctor</button>}
          </div>
          {doctors.error && <div style={{ padding: '0 22px' }}><ErrorBox message={doctors.error} onRetry={doctors.reload} /></div>}
          {!doctors.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={200} /></div> : list.length === 0 ? <Empty title="No doctors yet" /> : (
            <div className="crm-table-wrap">
              <table className="crm-table" style={{ minWidth: 620 }}>
                <thead><tr><th>Doctor</th><th>Department</th><th>OPD</th><th></th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id} style={d.isActive ? undefined : { opacity: 0.55 }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="crm-initials">{initials(d.name)}</span>
                          <div><div className="crm-cell-main">{d.name}{!d.isActive && ' (hidden)'}</div><div className="crm-cell-sub">{d.qualification}</div></div>
                        </div>
                      </td>
                      <td>{d.department ?? '—'}</td>
                      <td><div>{d.opdDays || '—'}</div><div className="crm-cell-sub">{d.opdTimings}</div></td>
                      <td className="num">{editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setEditDoc(d)}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editDept && <DeptModal dept={editDept === 'new' ? null : editDept} count={depts.data?.length ?? 0} onClose={() => setEditDept(null)}
        onSaved={() => { setEditDept(null); showToast('Saved.'); void depts.reload(); }} />}
      {editDoc && <DoctorModal doctor={editDoc === 'new' ? null : editDoc} departments={depts.data ?? []} onClose={() => setEditDoc(null)}
        onSaved={() => { setEditDoc(null); showToast('Saved.'); void doctors.reload(); }} />}
      {toast}
    </main>
  );
}

function DeptModal({ dept, count, onClose, onSaved }: { dept: Department | null; count: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dept?.name ?? '');
  const [active, setActive] = useState(dept?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    setSaving(true);
    try {
      const body = { name: name.trim(), isActive: active, order: dept?.order ?? count };
      if (dept) await crm.put(`/api/v1/departments/${dept.id}`, body); else await crm.post('/api/v1/departments', body);
      onSaved();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={dept ? 'Edit department' : 'Add department'} onClose={onClose} actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" disabled={saving} onClick={save}>Save</button></>}>
      <label className="crm-field">Name<input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Obstetrics & Gynaecology" /></label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 18, height: 18 }} /> Show to field agents</label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

function DoctorModal({ doctor, departments, onClose, onSaved }: { doctor: Doctor | null; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: doctor?.name ?? '', departmentId: doctor?.departmentId ?? departments[0]?.id ?? '', qualification: doctor?.qualification ?? '',
    opdTimings: doctor?.opdTimings ?? '', isActive: doctor?.isActive ?? true,
  });
  const [days, setDays] = useState<string[]>(() => (doctor?.opdDays ?? '').split(',').map((d) => d.trim()).filter(Boolean));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.name.trim()) return setError('Enter the doctor’s name.');
    setSaving(true);
    try {
      const body = { ...form, name: form.name.trim(), departmentId: form.departmentId || null, opdDays: DAYS.filter((d) => days.includes(d)).join(', ') || null };
      if (doctor) await crm.put(`/api/v1/doctors/${doctor.id}`, body); else await crm.post('/api/v1/doctors', body);
      onSaved();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={doctor ? 'Edit doctor' : 'Add doctor'} onClose={onClose} actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" disabled={saving} onClick={save}>Save</button></>}>
      <div className="crm-form-grid">
        <label className="crm-field">Name<input className="crm-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dr. A. Kumar" /></label>
        <label className="crm-field">Qualification (optional)<input className="crm-input" value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="e.g. MS (OBG)" /></label>
        <label className="crm-field">Department
          <select className="crm-select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="crm-field">OPD timing<input className="crm-input" value={form.opdTimings} onChange={(e) => setForm({ ...form, opdTimings: e.target.value })} placeholder="e.g. 10 am – 2 pm" /></label>
      </div>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, paddingBottom: 8 }}>OPD days</legend>
        <div className="crm-chips">
          {DAYS.map((d) => <button key={d} type="button" className="crm-chip is-soft" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}>{d}</button>)}
        </div>
      </fieldset>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} style={{ width: 18, height: 18 }} /> Currently practising here</label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
