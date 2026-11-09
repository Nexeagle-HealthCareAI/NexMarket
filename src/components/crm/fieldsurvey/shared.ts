/** Types and helpers for occasional field surveys in the CRM. */

export type QType = 'text' | 'number' | 'yesno' | 'choice' | 'multi';
export interface FQuestion { id: string; text: string; type: QType; options?: string[] | null; required: boolean }
export interface Person { agentId: string; name: string; role: string; block?: string | null }
export interface Defaults { spotTypes: string[]; roadTypes: string[]; questionTypes: QType[]; people: Person[] }

export const Q_LABEL: Record<QType, string> = { text: 'Written answer', number: 'Number', yesno: 'Yes / No', choice: 'Pick one', multi: 'Pick any' };

/** Distinct, readable colours (first ones for the commonest types). */
const PALETTE = ['#0a72d6', '#d9822b', '#0f8a5f', '#b42318', '#7b3fe4', '#0e7490', '#c2185b', '#6d4c41', '#558b2f', '#f2a600', '#455a64', '#00897b', '#8e24aa', '#5c6bc0'];
export const colorOf = (list: string[], v?: string | null) => {
  const i = v ? list.findIndex((x) => x.toLowerCase() === v.toLowerCase()) : -1;
  return i < 0 ? '#8a93a6' : PALETTE[i % PALETTE.length];
};

export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', active: 'Open', closed: 'Closed', assigned: 'Not started', started: 'In progress', submitted: 'Submitted' };

export const roleLabel = (r: string) => ({ field_rep: 'Field agent', admin: 'Admin', Admin: 'Admin', hr: 'HR', manager: 'Manager' } as Record<string, string>)[r] ?? r.replace(/_/g, ' ');

export const newId = () => Math.random().toString(36).slice(2, 12);
