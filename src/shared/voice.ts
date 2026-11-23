// Sprache: Verträge und der reine Kern des Routings. Kein Netz, kein DOM, keine Uhr.
// Stufen: 0 Rückfrage mit Nummern beantworten, 1 Diktat ins offene Notizfeld, 2 Namensabgleich im Code,
// 3 Jev über die sichtbaren Optionen (im Hauptprozess), 4 bei knapper Wahl Nummern an die Kandidaten.
// Sprachabhängig: Zahlwörter, eingebaute Sichern-Wörter und wie locker „klingt fast gleich“ ist (Deutsch, Englisch).

import type { Language } from "./settings.ts";

/** Was man gerade sagen kann. `phrases` klein geschrieben, ohne Satzzeichen. */
export type VoiceOption = {
  id: string;
  /** Bedeutung für Jev, ein ganzer Satz. */
  meaning: string;
  /** Wörter für den Namensabgleich im Code. */
  phrases: string[];
  /** Gilt auch, während ein Notizfeld offen ist (sonst wird dort alles Gesagte zur Notiz). */
  whileDictating?: boolean;
  /** Kurzer Name für die Anzeige nach dem Befehl, etwa „Übersicht“. */
  label: string;
  /** Bei gleichnamigen Zielen gewinnt dieses, etwa der Kopf des Bildes, das gerade im Blick ist. */
  preferred?: boolean;
};

export type VoiceContext = {
  /** Beschreibung der Ansicht für Jev. */
  screen: string;
  state: Record<string, unknown>;
  options: VoiceOption[];
  /** Ein Notizfeld ist offen: Gesagtes wird zur Notiz. */
  dictating: boolean;
  /** Offene Rückfrage: IDs der Kandidaten in der gezeigten Reihenfolge. */
  pending: string[] | null;
  /** Sprache der Oberfläche und der Phrasen. Fehlt sie, gilt Deutsch. */
  language?: Language;
};

export type VoiceStage = "number" | "dictation" | "code" | "jev";

export type VoiceDecision =
  | { kind: "command"; id: string; stage: VoiceStage; probability?: number }
  /** `save`: das Schlüsselwort am Ende sagt „Notiz sichern“; `text` ist dann ohne das Wort, gern auch leer. */
  | { kind: "dictation"; text: string; save?: boolean }
  /** Rückfrage mit Nummern. `dictation`: zusätzlich „als Text übernehmen“ (beim Diktat, Jev unsicher). */
  | { kind: "ask"; candidates: string[]; dictation?: string }
  | { kind: "none"; reason: VoiceNoneReason };

export type VoiceNoneReason = "silent" | "empty" | "unclear" | "not_addressed" | "no_key" | "jev_error" | "whisper_error";

export type VoiceRequest = { audio: Uint8Array; mime: string; context: VoiceContext };

export type VoiceResult = {
  transcript: string;
  decision: VoiceDecision;
  timings: { whisperMs: number; jevMs: number; totalMs: number };
};

/** Klein, ohne Satzzeichen, einfache Leerzeichen. Umlaute bleiben. */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[„“”"'‚‘’.,;:!?()[\]…–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DE_NUMBERS: Record<string, number> = { eins: 1, ein: 1, eine: 1, erste: 1, ersten: 1, zwei: 2, zwo: 2, zweite: 2, zweiten: 2, drei: 3, dritte: 3, dritten: 3, vier: 4, vierte: 4, fünf: 5, fünfte: 5 };
const EN_CARDINALS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const EN_ORDINALS = ["first", "second", "third", "fourth", "fifth"];
const EN_NUMBERS: Record<string, number> = Object.fromEntries([...EN_CARDINALS.map((w, i) => [w, i + 1]), ...EN_ORDINALS.map((w, i) => [w, i + 1])]);
const NUMBERS: Record<Language, Record<string, number>> = { de: DE_NUMBERS, en: EN_NUMBERS };

/** „zwei“, „die zweite“, „Nummer 2“, „the second one“ → 2; sonst null. Nur kurze Antworten zählen. */
export function spokenNumber(text: string, lang: Language = "de"): number | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  const numbers = NUMBERS[lang];
  for (const w of words) {
    if (/^\d+$/.test(w)) return Number(w);
    if (Object.hasOwn(numbers, w)) return numbers[w]!;
  }
  return null;
}

/** Zahlwörter für die Phrasen der Anmerkungen: 3 → ["3", "drei"] oder ["3", "three"]. */
export function numberWords(n: number, lang: Language = "de"): string[] {
  const word =
    lang === "en" ? EN_CARDINALS[n - 1] : Object.entries(DE_NUMBERS).find(([w, v]) => v === n && !/e$|en$/.test(w) && w !== "ein" && w !== "zwo")?.[0];
  return word ? [String(n), word] : [String(n)];
}

const contains = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/** Bis zu so vielen Wörtern darf der Code allein entscheiden. Längere Sätze gehen an Jev. */
export const CODE_MAX_WORDS = 6;

/** Beim Diktat gilt eine Aufnahme nur bis zu so vielen Wörtern als möglicher Befehl. */
const DICTATION_COMMAND_WORDS = 2;

/** Bis zu so vielen Wörtern fragt das Diktat Jev, ob ein Befehl gemeint ist. */
export const DICTATION_JEV_WORDS = 4;

/** Kennung der Wahl „als Text übernehmen“ in Jevs Frage beim Diktat. */
export const DICTATE_ID = "diktat";

/** Option für Jev beim Diktat: die Worte sind Inhalt der Notiz. */
export const DICTATE_OPTION: VoiceOption = {
  id: DICTATE_ID,
  meaning: "The words are content for the note being dictated (text to write down), not an instruction to the interface.",
  phrases: [],
  label: "Als Text",
};

/** Jevs Antwort beim Diktat: sicher ein Befehl → ausführen; vielleicht ein Befehl → nachfragen; sonst Text. */
export function decideDictation(probabilities: Record<string, number>, options: VoiceOption[], text: string): VoiceDecision {
  const [top] = options
    .filter((o) => o.whileDictating)
    .map((o) => [o.id, probabilities[o.id] ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  if (top && top[1] >= JEV_SURE) return { kind: "command", id: top[0], stage: "jev", probability: top[1] };
  if (top && top[1] >= JEV_CANDIDATE) return { kind: "ask", candidates: [top[0]], dictation: text };
  return { kind: "dictation", text };
}

/** Zahl der Einfüge-, Lösch- und Tauschschritte zwischen zwei Wörtern. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** Klingt fast gleich, locker (5.11.: „viel lockerer, fuzzy bei einzelnen Wörtern“):
 * ab 6 Zeichen zwei Schritte Abstand, ab 4 einer, kürzere nur genau; dazu gleicher Anfang von mindestens
 * 5 Zeichen bei höchstens 2 Zeichen Längenunterschied („sicher“, „sicherung“ → „sichern“).
 * Englisch strenger: Kurze Wörter liegen dort dicht beieinander („save“, „same“, „safe“, „have“), deshalb unter
 * 5 Zeichen nur genau, ab 5 ein Schritt, ab 8 zwei, ohne die Regel zum gleichen Anfang. */
export function soundsLike(heard: string, phrase: string, lang: Language = "de"): boolean {
  if (lang === "en") {
    if (phrase.length < 5) return heard === phrase;
    return editDistance(heard, phrase) <= (phrase.length >= 8 ? 2 : 1);
  }
  if (phrase.length < 4) return heard === phrase;
  if (editDistance(heard, phrase) <= (phrase.length >= 6 ? 2 : 1)) return true;
  let common = 0;
  while (common < Math.min(heard.length, phrase.length) && heard[common] === phrase[common]) common++;
  return common >= 5 && Math.abs(heard.length - phrase.length) <= 2;
}

/** Kurze Aufnahme beim Diktat trifft einen Befehl: als Ganzes oder mit einem ihrer Wörter („sichern bitte“). */
function dictationHit(text: string, phrases: string[], lang: Language): boolean {
  const words = text.split(" ");
  return phrases.some((p) => soundsLike(text, p, lang) || (!p.includes(" ") && words.some((w) => soundsLike(w, p, lang))));
}

/**
 * Endet das Diktat mit einem Schlüsselwort zum Sichern? Dann den Text ohne das Wort, sonst null.
 * Das Wort klingt nur fast gleich (soundsLike), Whisper schreibt es mal groß, mal mit Punkt.
 */
export function stripSaveWord(transcript: string, saveWords: string[], lang: Language = "de"): string | null {
  const tokens = transcript.trim().split(/\s+/);
  while (tokens.length && !normalize(tokens.at(-1)!)) tokens.pop();
  for (const word of saveWords) {
    const wanted = normalize(word);
    const n = wanted.split(" ").length;
    if (!wanted || tokens.length < n) continue;
    const heard = normalize(tokens.slice(-n).join(" "));
    if (!soundsLike(heard, wanted, lang)) continue;
    return tokens
      .slice(0, -n)
      .join(" ")
      .replace(/[\s,;:–—-]+$/, "")
      .trim();
  }
  return null;
}

/** Sichern-Wörter, die immer gelten, auch ohne Schlüsselwort in den Einstellungen. Längere zuerst. */
export const BUILT_IN_SAVE_WORDS: Record<Language, string[]> = { de: ["sichern", "speichern"], en: ["save it", "save"] };

/**
 * Notiz und „sichern“ in einer Äußerung, ohne eigenes Schlüsselwort: „Kurz sichern.“, „Kurz, sicher.“,
 * zusammengeschrieben „Fahrtsichern.“; englisch „Too tight, save.“. Gibt den Text davor zurück, sonst null.
 * „sichern“ allein ist der Befehl.
 */
export function stripBuiltInSave(transcript: string, lang: Language = "de"): string | null {
  const rest = stripSaveWord(transcript, BUILT_IN_SAVE_WORDS[lang], lang);
  if (rest) return rest;
  if (rest === "" || lang !== "de") return null;
  // Zusammengeschrieben: das Wort davor hat mindestens 4 Buchstaben, damit „absichern“, „versichern“ Wörter bleiben.
  const m = transcript.trim().match(/^(.*?)(\p{L}{4,})(sichern|speichern)[\s.!?…]*$/iu);
  if (!m || /^(rück|zwischen)$/i.test(m[2]!)) return null;
  return `${m[1]}${m[2]}`.trim();
}

/** Stufen im Code. `jev` heißt: Der Code findet nichts Eindeutiges. `saveWords`: Schlüsselwörter aus den Einstellungen. */
export function routeInCode(transcript: string, ctx: VoiceContext, saveWords: string[] = []): VoiceDecision | { kind: "jev"; namesakes: string[]; dictation?: boolean } {
  const text = normalize(transcript);
  if (!text) return { kind: "none", reason: "empty" };
  const lang = ctx.language ?? "de";

  if (ctx.pending?.length) {
    const n = spokenNumber(text, lang);
    const id = n ? ctx.pending[n - 1] : undefined;
    if (id) return { kind: "command", id, stage: "number" };
  }

  if (ctx.dictating) {
    // Schlüsselwort am Ende: Rest wird Notiz, dann gesichert, in einer Äußerung (5.11.).
    const rest = stripSaveWord(transcript, saveWords, lang);
    if (rest !== null) return { kind: "dictation", text: rest, save: true };
    // Sonst gilt „sichern“ am Ende immer: vorher sicherte die App nur und verwarf das Wort davor (Log 22.11.).
    const before = stripBuiltInSave(transcript, lang);
    if (before !== null) return { kind: "dictation", text: before, save: true };
    const command =
      ctx.options.find((o) => o.whileDictating && o.phrases.includes(text)) ??
      // Kurze Aufnahme, die fast wie ein Befehl klingt: Whisper hört „sichern“ oft als „Sicher.“ (5.11.).
      (text.split(" ").length <= DICTATION_COMMAND_WORDS ? ctx.options.find((o) => o.whileDictating && dictationHit(text, o.phrases, lang)) : undefined);
    if (command) return { kind: "command", id: command.id, stage: "code" };
    // Kurz und kein klarer Befehl: Jev entscheidet, ob es ein Befehl oder Text für die Notiz ist (5.11.:
    // nur exakt geschriebene Befehle zu erkennen „bringt nichts“). Längere Aufnahmen sind immer Text.
    if (text.split(" ").length <= DICTATION_JEV_WORDS && ctx.options.some((o) => o.whileDictating)) return { kind: "jev", namesakes: [], dictation: true };
    return { kind: "dictation", text: transcript.trim() };
  }

  const exact = ctx.options.filter((o) => o.phrases.includes(text));
  if (exact.length === 1) return { kind: "command", id: exact[0]!.id, stage: "code" };
  const hits = exact.length ? exact : ctx.options.filter((o) => o.phrases.some((p) => contains(text, p)));
  const short = text.split(" ").length <= CODE_MAX_WORDS;
  if (short && hits.length === 1) return { kind: "command", id: hits[0]!.id, stage: "code" };
  const preferred = hits.filter((o) => o.preferred);
  if (short && hits.length > 1 && preferred.length === 1) return { kind: "command", id: preferred[0]!.id, stage: "code" };
  // Mehrere gleichnamige Ziele, etwa zwei Köpfe: Jev entscheidet, ist es nicht sicher, wird nachgefragt.
  return { kind: "jev", namesakes: short && hits.length >= 2 && hits.length <= 3 ? hits.map((o) => o.id) : [] };
}

/** Sicher genug, um ohne Rückfrage auszuführen. */
export const JEV_SURE = 0.8;
/** Ab hier zählt eine Option als Kandidat für die Rückfrage. */
export const JEV_CANDIDATE = 0.2;

/** Jevs Antwort auswerten: ausführen, nachfragen oder nichts tun. */
export function decideFromJev(probabilities: Record<string, number>, addressed: number | null, options: VoiceOption[], namesakes: string[] = []): VoiceDecision {
  const known = new Set(options.map((o) => o.id));
  const ranked = Object.entries(probabilities)
    .filter(([id]) => known.has(id))
    .sort((a, b) => b[1] - a[1]);
  const none = probabilities.none ?? 0;
  const [top] = ranked;
  const notAddressed = addressed !== null && addressed < 0.5;
  // Das Wort passte im Code auf mehrere gleichnamige Ziele: ohne sichere Wahl unter genau diesen nachfragen, auch
  // wenn Jev „nichts davon“ vorne sieht (23.11.: „Zeig mir die Pfannen“ blieb sonst ab und zu ohne Wirkung).
  const askNamesakes = (): VoiceDecision => {
    const p = (id: string) => probabilities[id] ?? 0;
    return { kind: "ask", candidates: [...namesakes].sort((a, b) => p(b) - p(a)) };
  };
  if (!top || none >= top[1]) {
    if (namesakes.length >= 2 && !notAddressed) return askNamesakes();
    return { kind: "none", reason: notAddressed ? "not_addressed" : "unclear" };
  }
  if (top[1] >= JEV_SURE) return { kind: "command", id: top[0], stage: "jev", probability: top[1] };
  if (namesakes.length >= 2) return askNamesakes();
  const candidates = ranked.filter(([, p]) => p >= JEV_CANDIDATE).slice(0, 3).map(([id]) => id);
  if (candidates.length >= 2) return { kind: "ask", candidates };
  if (top[1] >= 0.5) return { kind: "command", id: top[0], stage: "jev", probability: top[1] };
  return { kind: "none", reason: "unclear" };
}
