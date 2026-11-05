import { addRange, type DateRangeValue } from '@/components/crm/DateRange';

export interface DiseaseOptions {
  today: string;
  conditions: { code: string; en: string; hi: string; dept: string }[];
  ageBands: { key: string; label: string }[];
  districts: { name: string; blocks: { name: string; panchayats: { id: string; name: string }[] }[] }[];
  camps: { id: string; title: string; date: string; block?: string | null }[];
  maxRows: number;
}

/** One line of the entry grid, as typed (the server reads and checks it). */
export interface GridRow { key: number; date: string; disease: string; age: string; sex: string; district: string; block: string; panchayat: string; count: string }
export const COLS = ['date', 'disease', 'age', 'sex', 'district', 'block', 'panchayat', 'count'] as const;
export type Col = typeof COLS[number];
export const COL_LABEL: Record<Col, string> = { date: 'Date', disease: 'Disease / complaint', age: 'Age', sex: 'Gender', district: 'District', block: 'Block', panchayat: 'Panchayat', count: 'Count' };

/** Header words people use in their sheets, for each column. */
const HEADERS: Record<Col, string[]> = {
  date: ['date', 'day', 'tarikh', 'तारीख', 'camp date', 'visit date'],
  disease: ['disease', 'complaint', 'diagnosis', 'condition', 'problem', 'illness', 'bimari', 'बीमारी', 'rog', 'रोग', 'symptom'],
  age: ['age', 'age group', 'umar', 'उम्र', 'age (years)', 'years'],
  sex: ['gender', 'sex', 'm/f', 'लिंग', 'ling'],
  district: ['district', 'zila', 'जिला', 'jila'],
  block: ['block', 'prakhand', 'प्रखंड'],
  panchayat: ['panchayat', 'gram panchayat', 'पंचायत', 'village', 'gaon', 'गांव'],
  count: ['count', 'number', 'no.', 'no', 'cases', 'patients', 'people', 'total', 'sankhya', 'संख्या'],
};

/** Which sheet column holds which field, from the header row. Columns it can't place are reported. */
export function mapHeaders(header: string[]): { map: Partial<Record<Col, number>>; unknown: string[] } {
  const map: Partial<Record<Col, number>> = {};
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const t = h.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return;
    const col = COLS.find((c) => map[c] == null && HEADERS[c].some((w) => t === w || t.startsWith(`${w} `) || t.startsWith(`${w}(`)));
    if (col) map[col] = i; else unknown.push(h.trim());
  });
  return { map, unknown };
}

export interface Filters { range: DateRangeValue; district: string; block: string; disease: string; sex: string; ageBand: string }
export const NO_FILTERS: Filters = { range: { key: '', from: '', to: '' }, district: '', block: '', disease: '', sex: '', ageBand: '' };

export function filterQuery(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  addRange(sp, f.range);
  if (f.district) sp.set('district', f.district);
  if (f.block) sp.set('block', f.block);
  if (f.disease) sp.set('disease', f.disease);
  if (f.sex) sp.set('sex', f.sex);
  if (f.ageBand) sp.set('ageBand', f.ageBand);
  return sp;
}

export const SEX_LABEL: Record<string, string> = { F: 'Female', M: 'Male', O: 'Other', U: 'Not noted' };

/** The body of an API error ("API /x → 422: {...}"), when it is JSON. */
export function errorBody<T>(e: unknown): T | null {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i < 0) return null;
  try { return JSON.parse(m.slice(i + 2)) as T; } catch { return null; }
}
