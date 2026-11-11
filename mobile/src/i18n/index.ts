import en, { type Strings } from './en';
import hi from './hi';
import hinglish from './hinglish';
import bn from './bn';
import uxCommon from './ux-common';
import uxToday from './ux-today';
import uxPartners from './ux-partners';
import uxChat from './ux-chat';
import uxHoardings from './ux-hoardings';

export type Lang = 'hi' | 'hinglish' | 'bn' | 'en';

export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'hi', label: 'हिंदी', short: 'हिं' },
  { code: 'hinglish', label: 'Hinglish', short: 'Hing' },
  { code: 'bn', label: 'বাংলা', short: 'বাং' },
  { code: 'en', label: 'English', short: 'EN' },
];

/**
 * Strings come from the four big language files plus the per-area ux-*.ts files. Screen agents add keys only to
 * their own ux file; every key works with t() and is type-checked.
 */
type BaseKey = keyof Strings;
type UxKey = keyof typeof uxCommon.en | keyof typeof uxToday.en | keyof typeof uxPartners.en | keyof typeof uxChat.en | keyof typeof uxHoardings.en;
export type StringKey = BaseKey | UxKey;

// A ux key may not reuse a key from the big files or another ux file (tsc points here if one does).
type Dupes = Extract<keyof typeof uxCommon.en, BaseKey | keyof typeof uxToday.en | keyof typeof uxPartners.en | keyof typeof uxChat.en>
  | Extract<keyof typeof uxToday.en, BaseKey | keyof typeof uxPartners.en | keyof typeof uxChat.en>
  | Extract<keyof typeof uxPartners.en, BaseKey | keyof typeof uxChat.en>
  | Extract<keyof typeof uxChat.en, BaseKey>
  | Extract<keyof typeof uxHoardings.en, BaseKey | keyof typeof uxCommon.en | keyof typeof uxToday.en | keyof typeof uxPartners.en | keyof typeof uxChat.en>;
const noDuplicateKeys: [Dupes] extends [never] ? true : { duplicateKey: Dupes } = true;
void noDuplicateKeys;

const UX = [uxCommon, uxToday, uxPartners, uxChat, uxHoardings];
const BASE: Record<Lang, Strings> = { hi, hinglish, bn, en };
const TABLES = {} as Record<Lang, Record<string, string>>;
for (const l of ['hi', 'hinglish', 'bn', 'en'] as Lang[]) {
  TABLES[l] = Object.assign({}, BASE[l], ...UX.map((u) => u[l]));
}

/**
 * Fills {name} placeholders. Counts: "{n|one|other}" picks the first word when n is 1, the second otherwise
 * (e.g. 'Met {n} {n|time|times}'), so "1 days" never shows. Missing keys fall back to English.
 */
export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  let s = TABLES[lang]?.[key] ?? TABLES.en[key] ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, (_m, k: string, one: string, other: string) => (Number(vars[k]) === 1 ? one : other));
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export type TFn = (key: StringKey, vars?: Record<string, string | number>) => string;

/** t() with a count: tn(t, 'uxSyncWait', 3) is t('uxSyncWait', { n: 3 }). */
export function tn(t: TFn, key: StringKey, n: number, vars?: Record<string, string | number>): string {
  return t(key, { ...vars, n });
}

/** Bengali numerals look natural in Bengali; everything else uses 0-9. */
export function localeTag(lang: Lang): string {
  return lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
}
