// Sprache der Oberfläche für alle Features: Kontext und Hook. Welche Sprache gilt, entscheidet die App
// (app/LanguageProvider.tsx, aus den Einstellungen); hier wird sie nur gelesen.

import { createContext, useContext, useMemo } from "react";
import type { Language } from "../../shared/settings.ts";
import { LOCALES, phrases, t, type Params, type PhraseKey, type TextKey } from "../../shared/i18n/index.ts";

export const LanguageContext = createContext<Language>("de");

export type Translate = {
  lang: Language;
  /** Locale für Intl (Zahlen, Uhrzeit, Datum). */
  locale: string;
  t(key: TextKey, params?: Params): string;
  /** Wörter eines Sprachbefehls in dieser Sprache, normalisiert. */
  phrases(key: PhraseKey, params?: Params): string[];
};

/** Texte in der Sprache der Oberfläche. Ändert sich die Einstellung, zeichnet alles neu. */
export function useT(): Translate {
  const lang = useContext(LanguageContext);
  return useMemo(
    () => ({ lang, locale: LOCALES[lang], t: (key, params) => t(lang, key, params), phrases: (key, params) => phrases(lang, key, params) }),
    [lang],
  );
}
