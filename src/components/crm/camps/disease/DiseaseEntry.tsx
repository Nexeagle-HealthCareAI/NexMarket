'use client';

import { useMemo, useRef, useState } from 'react';
import { Copy, Download, FileUp, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Pager } from '@/components/crm/Pager';
import { friendlyError } from '@/components/crm/ui';
import { readCsv, readXlsx, excelDate } from './sheet';
import { COL_LABEL, COLS, errorBody, mapHeaders, type Col, type DiseaseOptions, type GridRow } from './shared';

interface SaveRes { ok: boolean; batchId?: string; dryRun?: boolean; summary: Summary }
interface Summary { rows: number; cases: number; unmatchedDisease: string[]; unmatchedPanchayat: string[] }
interface SaveErr { message: string; errors?: { row: number; fields: Partial<Record<Col, string>> }[]; summary?: Summary }

const PAGE = 50;
let seq = 1;

/**
 * Add disease data like a spreadsheet: type rows (date and count are filled in), paste a block of cells from Excel,
 * or upload an .xlsx/.csv file and check it here before saving. No names: date, disease, age, gender, place, count.
 */
export function DiseaseEntry({ options, toast, onSaved }: { options: DiseaseOptions; toast: (m: string) => void; onSaved: () => void }) {
  const blank = (from?: Partial<GridRow>): GridRow => ({
    key: seq++, date: from?.date ?? options.today, disease: '', age: '', sex: '', district: from?.district ?? '', block: from?.block ?? '', panchayat: '', count: '1',
  });
  const [rows, setRows] = useState<GridRow[]>(() => Array.from({ length: 5 }, () => blank()));
  const [errors, setErrors] = useState<Record<number, Partial<Record<Col, string>>>>({});
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<'grid' | 'upload'>('grid');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [campId, setCampId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok' | 'info'; text: string; detail?: string[] } | null>(null);
  const [last, setLast] = useState<{ batchId: string; rows: number; cases: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const conditionNames = useMemo(() => options.conditions.map((c) => c.en), [options]);
  const blocksOf = (district: string) => (district ? options.districts.find((d) => d.name === district)?.blocks ?? [] : options.districts.flatMap((d) => d.blocks));
  const panchayatsOf = (district: string, block: string) => blocksOf(district).find((b) => b.name === block)?.panchayats ?? [];
  const usedBlocks = useMemo(() => [...new Set(rows.map((r) => `${r.district}|${r.block}`).filter((k) => !k.endsWith('|')))], [rows]);

  const filled = rows.filter((r) => r.disease.trim() || r.age.trim() || r.sex || r.block || r.panchayat.trim());
  const people = filled.reduce((s, r) => s + (Number(r.count) > 0 ? Number(r.count) : 0), 0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const errCount = Object.keys(errors).length;

  const set = (i: number, col: Col, value: string) => {
    setRows((rs) => rs.map((r, k) => {
      if (k !== i) return r;
      const next = { ...r, [col]: value };
      if (col === 'district' && r.block && !blocksOf(value).some((b) => b.name === r.block)) next.block = '';
      if (col === 'block' && !r.district && value) next.district = options.districts.find((d) => d.blocks.some((b) => b.name === value))?.name ?? '';
      return next;
    }));
    if (errors[i]?.[col]) setErrors((e) => { const n = { ...e, [i]: { ...e[i] } }; delete n[i][col]; if (!Object.keys(n[i]).length) delete n[i]; return n; });
  };
  const addRows = (n = 5) => {
    setRows((rs) => { const lastRow = rs[rs.length - 1]; return [...rs, ...Array.from({ length: n }, () => blank(lastRow))]; });
  };
  const copyRow = (i: number) => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i], key: seq++ }, ...rs.slice(i + 1)]);
  const removeRow = (i: number) => {
    setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((_, k) => k !== i)));
    setErrors((e) => { const n: typeof e = {}; for (const [k, v] of Object.entries(e)) { const r = Number(k); if (r < i) n[r] = v; else if (r > i) n[r - 1] = v; } return n; });
  };
  const reset = (keep?: GridRow) => {
    setRows(Array.from({ length: 5 }, () => blank(keep ? { date: keep.date, district: keep.district, block: keep.block } : undefined)));
    setErrors({}); setPage(1); setSource('grid'); setFileNote(null);
  };

  /** A block of cells pasted from Excel or Google Sheets fills the grid from this cell, adding rows as needed. */
  const onPaste = (i: number, col: Col) => (e: React.ClipboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n'); if (lines[lines.length - 1] === '') lines.pop();
    const start = COLS.indexOf(col);
    setRows((rs) => {
      const out = [...rs];
      lines.forEach((line, k) => {
        const at = i + k;
        while (out.length <= at) out.push(blank(out[out.length - 1]));
        const cells = line.split('\t');
        const r = { ...out[at] };
        cells.forEach((v, c) => { const key = COLS[start + c]; if (key) r[key] = key === 'date' ? excelDate(v.trim()) : v.trim(); });
        out[at] = r;
      });
      return out;
    });
    setMsg({ tone: 'info', text: `Pasted ${lines.length} row${lines.length === 1 ? '' : 's'}. Check them, then save.` });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    const name = f.name.toLowerCase();
    if (name.endsWith('.xls')) { setMsg({ tone: 'bad', text: 'Old .xls files can\'t be read. In Excel, choose Save As → Excel Workbook (.xlsx) or CSV, then upload that.' }); return; }
    if (f.size > 8 * 1024 * 1024) { setMsg({ tone: 'bad', text: 'This file is over 8 MB. Split it into smaller files.' }); return; }
    try {
      const sheet = name.endsWith('.csv') || name.endsWith('.txt') ? readCsv(await f.text()) : await readXlsx(await f.arrayBuffer());
      // The header is the first of the top rows that names at least three of our columns.
      let hi = -1; let found = mapHeaders([]);
      for (let k = 0; k < Math.min(10, sheet.length); k++) { const m = mapHeaders(sheet[k] ?? []); if (Object.keys(m.map).length >= 3) { hi = k; found = m; break; } }
      if (hi < 0) { setMsg({ tone: 'bad', text: 'Couldn\'t find the column headings. The first row should say: Date, Disease, Age, Gender, District, Block, Panchayat, Count. Download the template to see.' }); return; }
      if (found.map.disease == null) { setMsg({ tone: 'bad', text: 'There is no Disease (or Complaint) column in this file.' }); return; }
      const data = sheet.slice(hi + 1).filter((r) => r.some((c) => (c ?? '').trim()));
      if (data.length === 0) { setMsg({ tone: 'bad', text: 'The file has headings but no rows.' }); return; }
      if (data.length > options.maxRows) { setMsg({ tone: 'bad', text: `This file has ${data.length.toLocaleString('en-IN')} rows. Upload up to ${options.maxRows.toLocaleString('en-IN')} at a time: split it into parts.` }); return; }
      const get = (r: string[], c: Col) => { const i = found.map[c]; return i == null ? '' : (r[i] ?? '').trim(); };
      const loaded = data.map((r) => ({
        key: seq++, date: found.map.date == null ? options.today : excelDate(get(r, 'date')) || options.today, disease: get(r, 'disease'), age: get(r, 'age'),
        sex: get(r, 'sex'), district: get(r, 'district'), block: get(r, 'block'), panchayat: get(r, 'panchayat'), count: get(r, 'count') || '1',
      }));
      setRows(loaded); setErrors({}); setPage(1); setSource('upload');
      const missing = COLS.filter((c) => found.map[c] == null && c !== 'district');
      setFileNote(`${f.name}: ${loaded.length.toLocaleString('en-IN')} rows`
        + (missing.length ? `. No ${missing.map((c) => COL_LABEL[c].toLowerCase()).join(', ')} column${missing.length === 1 ? '' : 's'}${missing.includes('date') ? ' (today\'s date is used)' : ''}${missing.includes('count') ? ' (each row counts as 1)' : ''}` : '')
        + (found.unknown.length ? `. Ignored: ${found.unknown.slice(0, 4).join(', ')}${found.unknown.length > 4 ? '…' : ''}` : ''));
      setMsg({ tone: 'info', text: 'File loaded into the grid. Check the rows (you can edit any cell), then save.' });
    } catch {
      setMsg({ tone: 'bad', text: 'This file couldn\'t be read. Save it as .xlsx or .csv and try again.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const template = () => {
    const lines = ['Date,Disease,Age,Gender,District,Block,Panchayat,Count',
      `${options.today},High BP,52,F,Kishanganj,Bahadurganj,,3`, `${options.today},Joint pain,60+,M,Kishanganj,Bahadurganj,,1`, `${options.today},Fever,6-14,F,Araria,Forbesganj,,5`];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'disease-data-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const save = async (dryRun: boolean) => {
    if (filled.length === 0) { setMsg({ tone: 'bad', text: 'Fill in at least one row.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await crm.post<SaveRes>('/api/v1/camps/disease/rows', {
        rows: rows.map(({ date, disease, age, sex, district, block, panchayat, count }) => ({ date, disease, age, sex, district, block, panchayat, count })),
        source, campId: campId || null, dryRun,
      });
      setErrors({});
      const detail = [
        res.summary.unmatchedDisease.length ? `Kept as typed (not one of the known diseases): ${res.summary.unmatchedDisease.join(', ')}` : '',
        res.summary.unmatchedPanchayat.length ? `Panchayat not found, counted in its block: ${res.summary.unmatchedPanchayat.join(', ')}` : '',
      ].filter(Boolean);
      if (dryRun) { setMsg({ tone: 'ok', text: `All ${res.summary.rows} rows look right: ${res.summary.cases.toLocaleString('en-IN')} people. Save when ready.`, detail }); return; }
      setLast({ batchId: res.batchId!, rows: res.summary.rows, cases: res.summary.cases });
      toast(`Saved ${res.summary.rows} row${res.summary.rows === 1 ? '' : 's'}: ${res.summary.cases.toLocaleString('en-IN')} people.`);
      setMsg(detail.length ? { tone: 'info', text: 'Saved. Note:', detail } : null);
      reset(filled[filled.length - 1]);
      onSaved();
    } catch (e) {
      const b = errorBody<SaveErr>(e);
      if (b?.errors?.length) {
        const map: Record<number, Partial<Record<Col, string>>> = {};
        for (const x of b.errors) map[x.row] = x.fields;
        setErrors(map);
        const first = Math.min(...b.errors.map((x) => x.row));
        setPage(Math.floor(first / PAGE) + 1);
        setMsg({ tone: 'bad', text: b.message, detail: b.errors.slice(0, 6).map((x) => `Row ${x.row + 1}: ${Object.values(x.fields).join(' ')}`) });
      } else setMsg({ tone: 'bad', text: b?.message ?? friendlyError(e) });
    } finally { setBusy(false); }
  };

  const undo = async () => {
    if (!last) return;
    setBusy(true);
    try { await crm.post(`/api/v1/camps/disease/batches/${last.batchId}/remove`, {}); toast(`Removed the ${last.rows} rows just saved.`); setLast(null); onSaved(); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  const cellErr = (i: number, c: Col) => errors[i]?.[c];
  const inputProps = (i: number, c: Col) => ({
    'aria-invalid': cellErr(i, c) ? true : undefined,
    title: cellErr(i, c),
    onPaste: onPaste(i, c),
    'aria-label': `${COL_LABEL[c]}, row ${i + 1}`,
  });

  return (
    <section className="crm-card dz-entry" aria-labelledby="dz-entry-h">
      <div className="crm-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h2 id="dz-entry-h" className="crm-h2">Add disease data</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>
            One row per group of people with the same disease, age, gender and place. No names. Paste straight from Excel, or upload a file.
          </span>
        </div>
        <button type="button" className="crm-btn is-ghost is-sm" onClick={template}><Download size={15} aria-hidden /> Template</button>
        <label className="crm-btn is-secondary is-sm" style={{ cursor: 'pointer' }}>
          <FileUp size={15} aria-hidden /> Upload Excel or CSV
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls" className="crm-sr" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>

      <div className="crm-chips" style={{ alignItems: 'center' }}>
        <label className="crm-sub" htmlFor="dz-camp" style={{ fontSize: 13, fontWeight: 600 }}>From a camp</label>
        <select id="dz-camp" className="crm-select" style={{ width: 'auto', maxWidth: 320 }} value={campId} onChange={(e) => setCampId(e.target.value)}>
          <option value="">Not linked to a camp</option>
          {options.camps.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.date}</option>)}
        </select>
        {fileNote && <span className="crm-note dz-file">{fileNote}</span>}
        <SyncCamps toast={toast} onDone={onSaved} />
      </div>
      <span className="crm-cell-sub">People registered in a camp&apos;s patient register are counted here automatically (by what the doctor ticked, their age, gender and the camp&apos;s place). Only add people who weren&apos;t registered there, so nobody is counted twice.</span>

      {msg && (
        <div className={`crm-note dz-msg is-${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>
          <strong>{msg.text}</strong>
          {msg.detail?.map((d) => <span key={d}>{d}</span>)}
        </div>
      )}

      <div className="dz-grid-wrap">
        <table className="dz-grid">
          <thead>
            <tr>
              <th scope="col" className="dz-n">#</th>
              {COLS.map((c) => <th key={c} scope="col" className={`dz-c-${c}`}>{COL_LABEL[c]}</th>)}
              <th scope="col"><span className="crm-sr">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, k) => {
              const i = (page - 1) * PAGE + k;
              const blockKey = `${r.district}|${r.block}`;
              return (
                <tr key={r.key} className={errors[i] ? 'has-err' : undefined}>
                  <td className="dz-n">{i + 1}</td>
                  <td><input type="date" value={r.date} max={options.today} onChange={(e) => set(i, 'date', e.target.value)} {...inputProps(i, 'date')} /></td>
                  <td><input value={r.disease} list="dz-diseases" maxLength={80} placeholder="e.g. High BP" onChange={(e) => set(i, 'disease', e.target.value)} {...inputProps(i, 'disease')} /></td>
                  <td><input value={r.age} placeholder="42 or 30-44" maxLength={12} onChange={(e) => set(i, 'age', e.target.value)} {...inputProps(i, 'age')} /></td>
                  <td>
                    <select value={['M', 'F', 'O', ''].includes(r.sex) ? r.sex : '__'} onChange={(e) => set(i, 'sex', e.target.value)} {...inputProps(i, 'sex')}>
                      <option value="">—</option><option value="F">F</option><option value="M">M</option><option value="O">Other</option>
                      {!['M', 'F', 'O', ''].includes(r.sex) && <option value="__">{r.sex}</option>}
                    </select>
                  </td>
                  <td>
                    <select value={r.district} onChange={(e) => set(i, 'district', e.target.value)} {...inputProps(i, 'district')}>
                      <option value="">—</option>
                      {r.district && !options.districts.some((d) => d.name === r.district) && <option value={r.district}>{r.district}</option>}
                      {options.districts.map((d) => <option key={d.name}>{d.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.block} onChange={(e) => set(i, 'block', e.target.value)} {...inputProps(i, 'block')}>
                      <option value="">—</option>
                      {r.block && !blocksOf(r.district).some((b) => b.name === r.block) && <option value={r.block}>{r.block}</option>}
                      {blocksOf(r.district).map((b) => <option key={`${r.district}${b.name}`}>{b.name}</option>)}
                    </select>
                  </td>
                  <td><input value={r.panchayat} list={r.block ? `dz-p-${usedBlocks.indexOf(blockKey)}` : undefined} maxLength={80} placeholder="Optional" onChange={(e) => set(i, 'panchayat', e.target.value)} {...inputProps(i, 'panchayat')} /></td>
                  <td><input value={r.count} inputMode="numeric" maxLength={5} onChange={(e) => set(i, 'count', e.target.value.replace(/[^\d]/g, ''))} {...inputProps(i, 'count')} /></td>
                  <td className="dz-act">
                    <button type="button" onClick={() => copyRow(i)} aria-label={`Copy row ${i + 1}`} title="Copy row"><Copy size={14} aria-hidden /></button>
                    <button type="button" onClick={() => removeRow(i)} aria-label={`Remove row ${i + 1}`} title="Remove row"><Trash2 size={14} aria-hidden /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="dz-diseases">{conditionNames.map((n) => <option key={n} value={n} />)}</datalist>
        {usedBlocks.map((k, n) => { const [d, b] = k.split('|'); return <datalist key={k} id={`dz-p-${n}`}>{panchayatsOf(d, b).map((p) => <option key={p.id} value={p.name} />)}</datalist>; })}
      </div>
      {pages > 1 && <Pager page={page} pages={pages} total={rows.length} size={PAGE} onPage={setPage} noun="rows" />}

      <div className="dz-foot">
        <button type="button" className="crm-btn is-ghost is-sm" onClick={() => addRows(5)}><Plus size={15} aria-hidden /> Add 5 rows</button>
        <span className="crm-sub" style={{ flex: 1, fontSize: 13 }}>
          {filled.length} row{filled.length === 1 ? '' : 's'} · {people.toLocaleString('en-IN')} {people === 1 ? 'person' : 'people'}{errCount ? ` · ${errCount} to fix` : ''}
        </span>
        {last && <button type="button" className="crm-btn is-ghost is-sm" onClick={() => void undo()} disabled={busy}><Undo2 size={15} aria-hidden /> Undo last save ({last.rows})</button>}
        <button type="button" className="crm-btn is-ghost is-sm" onClick={() => reset()} disabled={busy}>Clear</button>
        <button type="button" className="crm-btn is-secondary" onClick={() => void save(true)} disabled={busy || filled.length === 0}>Check</button>
        <button type="button" className="crm-btn" onClick={() => void save(false)} disabled={busy || filled.length === 0}>{busy ? 'Saving…' : `Save ${filled.length || ''} row${filled.length === 1 ? '' : 's'}`}</button>
      </div>
    </section>
  );
}

/** Brings every camp's patient register into Disease data. Needed once for camps held before this existed; later camps update by themselves. */
function SyncCamps({ toast, onDone }: { toast: (m: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await crm.post<{ camps: number; people: number }>('/api/v1/camps/disease/sync-camps', {});
      toast(`Camp registers brought in: ${r.people.toLocaleString('en-IN')} people from ${r.camps} camp${r.camps === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  return <button type="button" className="crm-btn is-ghost is-sm" style={{ marginLeft: 'auto' }} onClick={() => void run()} disabled={busy}><RefreshCw size={15} aria-hidden /> {busy ? 'Bringing in…' : 'Bring in camp registers'}</button>;
}
