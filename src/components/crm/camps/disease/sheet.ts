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

// ─── Writing a small .xlsx (for the template) ───────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip with the files stored as they are (no compression): enough for a small spreadsheet. */
function zip(files: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)].map((p) => p as BlobPart), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** An Excel workbook with one sheet of text and numbers; the first row is bold and frozen. */
export function writeXlsx(rows: (string | number)[][], sheetName = 'Data', widths: number[] = []): Blob {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`; const st = ri === 0 ? ' s="1"' : '';
    return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t>${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>` },
  ]);
}
