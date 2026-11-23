// Texte in der Sprache der Oberfläche: t() für Texte, phrases() für die Wörter eines Sprachbefehls.
// Ohne Bibliothek: Platzhalter {name}, Einzahl und Mehrzahl über `count` (Intl.PluralRules).

import type { Language } from "../settings.ts";
import { normalize } from "../voice.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
import type { Entry, MessagesOf, Plural } from "./types.ts";

export type { Plural } from "./types.ts";
export type Messages = MessagesOf<typeof de>;
export const CATALOGS: Record<Language, Messages> = { de, en };

type Key = keyof Messages;
/** Schlüssel mit Text oder Einzahl/Mehrzahl. */
export type TextKey = { [K in Key]: Messages[K] extends readonly string[] ? never : K }[Key];
/** Schlüssel mit Sprachphrasen. */
export type PhraseKey = { [K in Key]: Messages[K] extends readonly string[] ? K : never }[Key];
export type Params = Record<string, string | number>;

const fill = (text: string, params: Params = {}) => text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));

const isPlural = (e: Entry): e is Plural => typeof e === "object" && !Array.isArray(e);

const rules: Partial<Record<Language, Intl.PluralRules>> = {};
const pluralOf = (lang: Language, count: number) => (rules[lang] ??= new Intl.PluralRules(lang)).select(count) === "one" ? "one" : "other";

/** Text zum Schlüssel. Bei Einzahl/Mehrzahl entscheidet `params.count`. */
export function t(lang: Language, key: TextKey, params?: Params): string {
  const entry = CATALOGS[lang][key] as Entry;
  if (isPlural(entry)) return fill(entry[pluralOf(lang, Number(params?.count ?? 0))], params);
  return fill(entry as string, params);
}

/** Wörter eines Sprachbefehls, ausgefüllt und normalisiert, ohne Doppelte. */
export function phrases(lang: Language, key: PhraseKey, params?: Params): string[] {
  const list = CATALOGS[lang][key] as readonly string[];
  return [...new Set(list.map((p) => normalize(fill(p, params))).filter(Boolean))];
}

/** Platzhalter eines Textes, zum Prüfen, dass beide Sprachen dieselben haben. */
export const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();

/** Locale für Intl: Zahlen, Uhrzeit, Datum. */
export const LOCALES: Record<Language, string> = { de: "de-DE", en: "en-US" };
