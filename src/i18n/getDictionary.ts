import 'server-only';

const dictionaries = {
  en: () => import('./en.json').then((module) => module.default),
  hi: () => import('./hi.json').then((module) => module.default),
  hinglish: () => import('./hinglish.json').then((module) => module.default),
};

export type Locale = keyof typeof dictionaries;
export type Dictionary = Awaited<ReturnType<typeof dictionaries.en>>;

export const getDictionary = async (locale: string): Promise<Dictionary> => {
  if (locale in dictionaries) {
    return dictionaries[locale as Locale]();
  }
  return dictionaries.en(); // Default
};
