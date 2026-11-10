import type { Lang } from './index';

/**
 * Shape of a per-area string file (ux-*.ts): English is the key source, and every other language must have
 * exactly the same keys (a missing or extra key is a type error).
 */
export type UxTable<E extends Record<string, string>> = { en: E } & Record<Exclude<Lang, 'en'>, Record<keyof E, string>>;
