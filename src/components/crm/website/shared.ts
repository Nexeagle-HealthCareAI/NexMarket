import { friendlyError, type Tone } from '@/components/crm/ui';

export type Kind = 'article' | 'faq' | 'site' | 'doctor' | 'camp' | 'notice' | 'testimonial' | 'service' | 'location' | 'redirect';
export type Status = 'draft' | 'review' | 'approved' | 'publishing' | 'published' | 'unpublished';
export interface Row {
  id: string; type: Kind; key: string; title: string; status: Status; live: boolean; changed: boolean; version: number; sortOrder: number;
  aiDrafted: boolean; archived: boolean; note?: string | null; department?: string | null; category?: string | null;
  submittedByName?: string | null; reviewedByName?: string | null; reviewedAt?: string | null; publishedAt?: string | null;
  firstPublishedOn?: string | null; hasPicture: boolean; createdByName: string; updatedByName: string; updatedAt: string;
  publishAt?: string | null; unpublishAt?: string | null; scheduledByName?: string | null; stagedAt?: string | null; date?: string | null; linked?: boolean | null;
}
export interface Job {
  id: string; title: string; status: 'queued' | 'checking' | 'merging' | 'deploying' | 'live' | 'staged' | 'failed' | 'deploy_failed'; note?: string | null;
  prUrl?: string | null; prNumber?: number | null; branch?: string | null; startedByName: string; startedAt: string; finishedAt?: string | null;
  running: boolean; log?: string | null; files?: string[] | null; target?: string;
}
export interface Setup {
  connected: boolean; imported: boolean; siteUrl?: string | null; repo?: string | null; reviewTypes: string[]; departments: string[]; ai: boolean; hasStaging: boolean;
  repoOwner?: string | null; repoName?: string | null; branch?: string | null; contentDir?: string | null; mediaDir?: string | null; appId?: string | null;
  privateKey?: string | null; token?: string | null; connectedAt?: string | null; importedAt?: string | null; keyUnreadable?: boolean;
  stagingBranch?: string | null; scanFiles?: string | null; syncedAt?: string | null; reReviewMonths?: number; headOffice?: string | null; branches?: string[];
}
export interface FieldDef {
  name: string; label: string; kind: 'text' | 'longtext' | 'paras' | 'lines' | 'date' | 'time' | 'bool' | 'select' | 'image' | 'phone' | 'url' | 'path' | 'pairs';
  required: boolean; max: number; help?: string | null; crmOnly: boolean; options?: string[] | null; a: string; b: string; aLabel: string; bLabel: string;
}
export interface TypeDef { key: Kind; label: string; plural: string; file: string; shape: string; keyField: string; help: string; needsReview: boolean; canCreate: boolean; canUnpublish: boolean; fields: FieldDef[] }
export interface Data {
  me: { write: boolean; review: boolean; publish: boolean; develop: boolean }; setup: Setup; aiOn: boolean; items: Row[]; publishes: Job[];
  faqCategories: string[]; siteFields: { key: string; label: string }[]; limits: { title: number; excerptMin: number; excerptMax: number }; types: TypeDef[];
}
export interface Section { heading: string; paragraphs: string[]; points?: string[] }
export interface Doc {
  slug?: string; title?: string; excerpt?: string; departmentId?: string; author?: string; image?: { src?: string; alt?: string };
  sections?: Section[]; references?: { label: string; url: string }[];
  id?: string; question?: string; answer?: string; category?: string; [k: string]: unknown;
}
export interface Version { id: string; version: number; action: string; note?: string | null; byName: string; at: string; reviewedByName?: string | null }
export interface One {
  item: Row; data: Doc; published?: Doc | null; problems: string[]; warnings: string[]; needsReview: boolean; address?: string | null;
  versions: Version[]; kind: TypeDef; dueForReview?: boolean; reviewedOn?: string | null; chain?: { org: string; version: number } | null; shared?: boolean;
}
export interface Media {
  id: string; name: string; path: string; mime: string; width: number; height: number; bytes: number; alt: string; onSite: boolean; version: number; archived: boolean;
  updatedByName: string; updatedAt: string; usedBy: { id: string; title: string; type: Kind; live: boolean }[];
}

export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { return (JSON.parse(m.slice(i + 2)) as { message?: string }).message ?? friendlyError(e); } catch { /* fall through */ } }
  return friendlyError(e);
};
export const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
export const dayText = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const nice = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const KIND: Record<Kind, string> = {
  article: 'Article', faq: 'Question', site: 'Hospital details', doctor: 'Doctor', camp: 'Health camp', notice: 'Notice', testimonial: 'Patient story', service: 'Service page', location: 'Area served', redirect: 'Redirect',
};
export const STATUS: Record<Status, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, review: { label: 'Waiting for review', tone: 'warn' }, approved: { label: 'Ready to publish', tone: 'info' },
  publishing: { label: 'Publishing…', tone: 'accent' }, published: { label: 'On the website', tone: 'ok' }, unpublished: { label: 'Taken down', tone: 'neutral' },
};
export const ACTION: Record<string, string> = {
  created: 'Created', saved: 'Saved', submitted: 'Sent for review', approved: 'Approved', sent_back: 'Sent back', published: 'Published',
  unpublished: 'Taken down', imported: 'Brought in from the website', failed: 'Publishing failed', staged: 'Put on staging',
  changed_on_github: 'Changed directly on GitHub', removed_on_github: 'Removed directly on GitHub',
};
export const toLines = (a?: unknown) => (Array.isArray(a) ? (a as string[]) : []).join('\n');
export const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
export const toParas = (a?: unknown) => (Array.isArray(a) ? (a as string[]) : []).join('\n\n');
export const fromParas = (s: string) => s.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
/** A date and time for a datetime-local input, in the browser's own time. */
export const localInput = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d); const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};

/** Makes a picture at most 1600 pixels wide and turns it into WebP (JPEG where the browser can't), before it is sent. */
export async function shrinkPicture(file: File, keepType?: string): Promise<{ blob: Blob; type: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file is not a picture the browser can read.')); i.src = url; });
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const width = Math.round(img.naturalWidth * scale); const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    const want = keepType ?? 'image/webp';
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, want, 0.82));
    if (blob && blob.type === want) return { blob, type: want, width, height };
    if (keepType) return { blob: file, type: file.type, width: img.naturalWidth, height: img.naturalHeight };
    const jpg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    return jpg ? { blob: jpg, type: 'image/jpeg', width, height } : { blob: file, type: file.type, width: img.naturalWidth, height: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

/** The fields that differ between two versions, for "Compare". */
export function diff(a: Doc, b: Doc): { field: string; before: string; after: string }[] {
  const flat = (o: unknown, prefix = '', out: Record<string, string> = {}) => {
    if (Array.isArray(o)) o.forEach((v, i) => flat(v, `${prefix}[${i + 1}]`, out));
    else if (o && typeof o === 'object') Object.entries(o as Record<string, unknown>).forEach(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k, out));
    else if (o !== undefined && o !== null && o !== '') out[prefix] = String(o);
    return out;
  };
  const x = flat(a); const y = flat(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).map((k) => ({ field: k, before: x[k] ?? '', after: y[k] ?? '' }));
}
