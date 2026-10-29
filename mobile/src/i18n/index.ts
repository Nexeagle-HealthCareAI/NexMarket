import en, { type StringKey, type Strings } from './en';
import hi from './hi';
import hinglish from './hinglish';
import bn from './bn';

export type Lang = 'hi' | 'hinglish' | 'bn' | 'en';

export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'hi', label: 'हिंदी', short: 'हिं' },
  { code: 'hinglish', label: 'Hinglish', short: 'Hing' },
  { code: 'bn', label: 'বাংলা', short: 'বাং' },
  { code: 'en', label: 'English', short: 'EN' },
];

const TABLES: Record<Lang, Strings> = { hi, hinglish, bn, en };

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  let s = TABLES[lang]?.[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export type TFn = (key: StringKey, vars?: Record<string, string | number>) => string;
export type { StringKey };

/** Bengali numerals look natural in Bengali; everything else uses 0-9. */
export function localeTag(lang: Lang): string {
  return lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
}
