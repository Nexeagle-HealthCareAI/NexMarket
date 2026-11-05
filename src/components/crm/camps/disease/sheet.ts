/**
 * Reads the first sheet of an .xlsx file or a .csv file into rows of text, in the browser, with no extra library.
 * An .xlsx file is a zip of XML files: this finds the first worksheet and its shared strings and reads the cells.
 */

export type Sheet = string[][];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The files inside a zip, by name (only the ones we ask for are unpacked). */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const lNameLen = v.getUint16(local + 26, true), lExtraLen = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + size);
    const bytes = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (bytes) files.set(name, dec.decode(bytes));
  }
  return files;
}

/** "B12" → column 1 (0-based). */
const colOf = (ref: string) => {
  let c = 0;
  for (const ch of ref) { const k = ch.charCodeAt(0); if (k < 65 || k > 90) break; c = c * 26 + (k - 64); }
  return c - 1;
};

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet> {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const si of Array.from(xml(ss).getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  // The first sheet in the workbook's order.
  let sheetPath = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort()[0];
  const wb = files.get('xl/workbook.xml'), rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = Array.from(xml(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) { const t = target.replace(/^\/?xl\//, '').replace(/^\//, ''); if (files.has(`xl/${t}`)) sheetPath = `xl/${t}`; }
  }
  if (!sheetPath) throw new Error('no sheet');
  const doc = xml(files.get(sheetPath)!);
  const out: Sheet = [];
  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const r = Number(row.getAttribute('r') ?? out.length + 1) - 1;
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r'); const col = ref ? colOf(ref) : cells.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text: string;
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = v;
      cells[col] = text;
    }
    out[r] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(out, (x) => x ?? []);
}

/** CSV with quotes, commas or semicolons, \r\n or \n. */
export function readCsv(text: string): Sheet {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows: Sheet = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Excel stores dates as days since 1899-12-30. */
export function excelDate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return v;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
  return d.toISOString().slice(0, 10);
}
