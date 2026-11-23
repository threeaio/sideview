// Glossar für whisper: Fachbegriffe, damit Whisper „RAG“ oder „Jev“ richtig schreibt. Übernommen aus
// labs/voice-control (server/glossary.mjs): Handeinträge aus config/glossary.json und den Erweiterungen, dazu
// Abkürzungen aus den Titeln der KB-Seiten, wenn KB_DIR auf eine KB zeigt. Neu: Die Namen, die gerade auf der Fläche sichtbar sind, stehen zuletzt,
// weil whisper.cpp nur das Ende des Prompts sieht.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** whisper.cpp nutzt nur die letzten rund 224 Token des Prompts. */
const MAX_PROMPT = 600;
const PREFIX = { de: "Fachbegriffe: ", en: "Terms: " } as const;
const ON_CANVAS = { de: "Im Canvas", en: "On the canvas" } as const;
const ACRONYM = /^(.*?)\s*\(([A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,7})\)/; // „Langform (ABK)“
const CAPS = /\b[A-Z][A-Z0-9]{1,4}\b/g; // Wörter in Versalien, 2 bis 5 Zeichen
const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/** `replace`: gehörte Schreibweisen (`spoken`) im Transkript durch den Begriff ersetzen. Nur für Wörter, die es im
 * Deutschen sonst nicht gibt (etwa „Kev“, das whisper als „Kef“ schreibt); „Chef“ für Jev darf nie ersetzt werden. */
export type GlossaryEntry = { term: string; spoken?: string[]; meaning?: string; replace?: boolean };

/** Handeinträge zuerst, dann Abkürzungen aus den Titeln, häufige zuerst. Doppelte fallen weg. */
export function buildGlossary(manual: GlossaryEntry[], pageTitles: string[]): string[] {
  const terms = new Map<string, string>();
  for (const e of manual) if (e?.term && !terms.has(norm(e.term))) terms.set(norm(e.term), e.term);
  const counts = new Map<string, { term: string; count: number }>();
  for (const title of pageTitles) {
    const seen = new Set<string>();
    const found = [...(title.match(ACRONYM)?.slice(2, 3) ?? []), ...[...title.matchAll(CAPS)].map((m) => m[0])];
    for (const term of found) {
      const key = norm(term);
      if (terms.has(key) || seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key) ?? { term, count: 0 };
      c.count++;
      counts.set(key, c);
    }
  }
  const derived = [...counts.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).map((c) => c.term);
  return [...terms.values(), ...derived];
}

/** Höchstens so viel Platz für die sichtbaren Namen. Ein zu langer Prompt lässt Whisper Sätze wiederholen
 * („Den Kopf besprechen. Den Kopf besprechen.“, gemessen am 5.11. mit 843 Zeichen). */
const MAX_VISIBLE = 240;

/** Prompt für whisper.cpp: Begriffe bis zum Budget, die sichtbaren Namen zuletzt, alles unter MAX_PROMPT. */
export function whisperPrompt(glossary: string[], visible: string[] = [], language: "de" | "en" = "de"): string {
  // „Kopf (Handy)“ und „Kopf (Desktop)“ sind für Whisper dasselbe Wort.
  const names = [...new Set(visible.map((v) => v.replace(/\s*\([^)]*\)\s*$/, "").replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  let shown = "";
  for (const name of names) {
    const next = shown ? `${shown}, ${name}` : name;
    if (next.length > MAX_VISIBLE) break;
    shown = next;
  }
  const tail = shown ? ` ${ON_CANVAS[language]}: ${shown}.` : "";
  const budget = MAX_PROMPT - PREFIX[language].length - tail.length - 1;
  const terms: string[] = [];
  let used = 0;
  for (const term of glossary) {
    const cost = term.length + (terms.length ? 2 : 0);
    if (used + cost > budget) break;
    terms.push(term);
    used += cost;
  }
  return ((terms.length ? `${PREFIX[language]}${terms.join(", ")}.` : "") + tail).trim();
}

/** Titel aus dem Frontmatter der KB-Seiten. Fehlt die KB, bleibt es beim Handglossar. */
async function pageTitles(kbDir: string): Promise<string[]> {
  const root = path.join(kbDir, "wiki", "pages");
  const files = (await readdir(root, { recursive: true }).catch(() => [] as string[])).map(String).filter((f) => f.endsWith(".md"));
  const titles: string[] = [];
  for (const f of files) {
    const text = await readFile(path.join(root, f), "utf8").catch(() => "");
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const title = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
    if (title) titles.push(title);
  }
  return titles;
}

const readEntries = async (files: string[]) =>
  (await Promise.all(files.map((f) => readFile(f, "utf8").then((t) => JSON.parse(t) as GlossaryEntry[], () => [] as GlossaryEntry[])))).flat();

/** Handeinträge aus allen Dateien (erste zuerst), dazu Abkürzungen aus der KB, wenn es eine gibt. */
export async function loadGlossary(files: string[], kbDir: string | null): Promise<string[]> {
  return buildGlossary(await readEntries(files), kbDir ? await pageTitles(kbDir) : []);
}

export type Alias = { term: string; pattern: RegExp };

/** Ersetzungen aus dem Glossar: nur Einträge mit `replace`, ganze Wörter, Groß- und Kleinschreibung egal. */
export function aliasesOf(manual: GlossaryEntry[]): Alias[] {
  return manual.flatMap((e) => {
    const variants = (e?.replace ? (e.spoken ?? []) : []).filter((v) => v.trim() && v.toLowerCase() !== e.term.toLowerCase());
    if (!variants.length) return [];
    const words = variants.map((v) => v.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    return [{ term: e.term, pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`, "giu") }];
  });
}

/** Transkript mit den Begriffen, wie sie heißen: „Nutze Kef.“ → „Nutze Kev.“ */
export function canonical(text: string, aliases: Alias[]): string {
  return aliases.reduce((t, a) => t.replace(a.pattern, a.term), text);
}

export async function loadAliases(files: string[]): Promise<Alias[]> {
  return aliasesOf(await readEntries(files));
}
