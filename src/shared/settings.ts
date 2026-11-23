// Einstellungen der App: Verträge und reine Regeln. Gespeichert in data/settings.json (Hauptprozess).

/** Was ein Schlüsselwort tut. Bisher nur eins: am Ende einer gesprochenen Notiz sichert es die Notiz. */
export type KeywordAction = "save";

export type Keyword = { word: string; action: KeywordAction };

/** Sprache der Oberfläche und der Spracherkennung. `auto`: wie das System (Deutsch, sonst Englisch). */
export type LanguageSetting = "auto" | "de" | "en";
export type Language = "de" | "en";
export const LANGUAGES: readonly Language[] = ["de", "en"];

/**
 * Entscheidungsmodell für Sprachbefehle: Jev von TypeSafe oder ein Dienst mit derselben Schnittstelle
 * (POST <baseUrl>/v1/systemone), etwa Kev lokal. Leer heißt: Vorgabe (api.typesafe.ai, jev). Der Schlüssel steht
 * nie hier, sondern in der Keychain oder in TYPESAFE_API_KEY.
 */
export type DecisionBackend = { baseUrl: string; model: string };

export type Settings = { keywords: Keyword[]; language: LanguageSetting; decision: DecisionBackend };

export const DEFAULT_SETTINGS: Settings = { keywords: [], language: "auto", decision: { baseUrl: "", model: "" } };

/** `auto` aufgelöst mit den bevorzugten Sprachen des Systems. */
export function resolveLanguage(setting: LanguageSetting, preferred: readonly string[]): Language {
  if (setting !== "auto") return setting;
  return preferred.find((l) => /^(de|en)\b/i.test(l))?.slice(0, 2).toLowerCase() === "de" ? "de" : "en";
}

/** Adresse eines Entscheidungsdienstes: leer oder http(s), ohne Schrägstrich am Ende. Sonst null. */
export function cleanBaseUrl(url: string): string | null {
  const u = url.trim().replace(/\/+$/, "");
  if (!u) return "";
  return /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(u) ? u : null;
}

/** Modellname: leer oder Buchstaben, Ziffern, Punkt, Strich, Unterstrich, Schrägstrich. */
export const cleanModel = (m: string) => (/^[\w.\-/:]{0,80}$/.test(m.trim()) ? m.trim() : null);


/** Schlüsselwörter bis zu so vielen Wörtern; länger spricht man nicht am Satzende. */
export const KEYWORD_MAX_WORDS = 3;

/** Aufgeräumtes Wort, oder ein Fehlercode, warum es nicht geht. */
export function cleanKeyword(word: string, taken: Keyword[]): { word: string } | { error: "empty" | "too_long" | "taken" } {
  const clean = word.replace(/[„“”"'.,;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return { error: "empty" };
  if (clean.split(" ").length > KEYWORD_MAX_WORDS) return { error: "too_long" };
  if (taken.some((k) => k.word.toLowerCase() === clean.toLowerCase())) return { error: "taken" };
  return { word: clean };
}

/** Liest eine gespeicherte Datei tolerant: Unbekanntes fällt weg, Fehlendes kommt aus den Vorgaben. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as { keywords?: unknown; language?: unknown; decision?: { baseUrl?: unknown; model?: unknown } };
  const keywords: Keyword[] = [];
  for (const k of Array.isArray(r.keywords) ? r.keywords : []) {
    const word = typeof k?.word === "string" ? k.word : "";
    const cleaned = cleanKeyword(word, keywords);
    if ("word" in cleaned && k.action === "save") keywords.push({ word: cleaned.word, action: "save" });
  }
  const language: LanguageSetting = r.language === "de" || r.language === "en" ? r.language : "auto";
  const baseUrl = typeof r.decision?.baseUrl === "string" ? (cleanBaseUrl(r.decision.baseUrl) ?? "") : "";
  const model = typeof r.decision?.model === "string" ? (cleanModel(r.decision.model) ?? "") : "";
  return { keywords, language, decision: { baseUrl, model } };
}

export const saveWords = (s: Settings) => s.keywords.filter((k) => k.action === "save").map((k) => k.word);
