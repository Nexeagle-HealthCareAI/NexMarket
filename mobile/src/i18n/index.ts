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

// Every organisation other than the first sees its own name wherever the app's wording names the first hospital.
// Longest wording first, so the full name is swapped before its shorter forms.
const FIRST_ORG_WORDING = [
  'Glisan Akbari SuperSpeciality Hospital', 'ग्लिसन अकबरी सुपर स्पेशलिटी हॉस्पिटल', 'গ্লিসান আকবরী সুপার স্পেশালিটি হাসপাতাল',
  'Glisan Akbari Hospital', 'Glisan Akbari', 'ग्लिसन अकबरी', 'গ্লিসান আকবরী',
];
let orgWording: string | null = null;
/** The organisation's own name, or null for the first organisation (which keeps its wording). */
export function setOrgWording(name: string | null) { orgWording = name && name.trim() ? name.trim() : null; }
export const orgDisplayName = () => orgWording ?? FIRST_ORG_WORDING[0];
/** True once this phone knows another organisation's own name (after a sign-in to it). */
export const hasOrgWording = () => orgWording != null;

// The organisation's everyday word: a lab's app says "lab" where a hospital's says "hospital".
const PLACE_WORDS: Record<string, { en: string; hi: string; bn: string }> = {
  clinic: { en: 'clinic', hi: 'क्लिनिक', bn: 'ক্লিনিক' },
  lab: { en: 'lab', hi: 'लैब', bn: 'ল্যাব' },
  pharmacy: { en: 'pharmacy', hi: 'फार्मेसी', bn: 'ফার্মেসি' },
  'diagnostic centre': { en: 'diagnostic centre', hi: 'डायग्नोस्टिक सेंटर', bn: 'ডায়াগনস্টিক সেন্টার' },
  'dialysis centre': { en: 'dialysis centre', hi: 'डायलिसिस सेंटर', bn: 'ডায়ালাইসিস সেন্টার' },
  centre: { en: 'centre', hi: 'सेंटर', bn: 'সেন্টার' },
};
let orgPlace: { en: string; hi: string; bn: string } | null = null;
/** "hospital" (or nothing) keeps the app's own wording. */
export function setOrgPlace(word: string | null) { orgPlace = (word && PLACE_WORDS[word]) || null; }

/** Swaps the word "hospital" for the organisation's own, in whichever script the text uses. */
export function placeWording(s: string, p: { en: string; hi: string; bn: string }): string {
  return s
    .replace(/\b([Hh])ospital\b/g, (_m, h: string) => (h === 'H' ? p.en.charAt(0).toUpperCase() + p.en.slice(1) : p.en))
    .replace(/अस्पताल|हॉस्पिटल/g, p.hi)
    // Bengali endings join the word: after a word ending in "i" they change shape (ফার্মেসিতে, ফার্মেসির).
    .replace(/হাসপাতাল(ের|ে)?/g, (_m, end?: string) => p.bn + (!end ? '' : p.bn.endsWith('ি') ? (end === 'ে' ? 'তে' : 'র') : end));
}

/**
 * Fills {name} placeholders. Counts: "{n|one|other}" picks the first word when n is 1, the second otherwise
 * (e.g. 'Met {n} {n|time|times}'), so "1 days" never shows. Missing keys fall back to English.
 */
export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  let s = TABLES[lang]?.[key] ?? TABLES.en[key] ?? key;
  // The organisation's name is set aside behind a marker first, so the place word is never changed inside a name.
  const named = !!orgWording && (s.includes('lisan') || s.includes('ग्लिसन') || s.includes('গ্লিসান'));
  if (named) for (const w of FIRST_ORG_WORDING) s = s.split(w).join('\u0001');
  // "Hospital" as a kind of partner (type_hospital) is a real hospital whoever is signed in.
  if (orgPlace && !key.startsWith('type_')) s = placeWording(s, orgPlace);
  if (named) s = s.split('\u0001').join(orgWording!);
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
