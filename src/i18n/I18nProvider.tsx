'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import type { Dictionary } from './getDictionary';

const I18nContext = createContext<Dictionary | null>(null);

export function I18nProvider({ dictionary, children }: { dictionary: Dictionary; children: ReactNode }) {
  return (
    <I18nContext.Provider value={dictionary}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslations() {
  const dictionary = useContext(I18nContext);
  if (!dictionary) {
    throw new Error('useTranslations must be used within an I18nProvider');
  }
  return dictionary;
}
