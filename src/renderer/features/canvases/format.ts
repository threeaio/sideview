// Texte für die Liste der Canvases. Reine Funktionen, in der Sprache der Oberfläche.

import type { CanvasSummary } from "../../../shared/contracts.ts";
import { LOCALES, t } from "../../../shared/i18n/index.ts";
import type { Language } from "../../../shared/settings.ts";

/** „3 Bilder · 1 Anmerkung“; leer: „Leer“. */
export function contentsLine(c: Pick<CanvasSummary, "items" | "annotations">, lang: Language = "de"): string {
  if (c.items === 0) return t(lang, "home.empty");
  const parts = [t(lang, "count.images", { count: c.items })];
  if (c.annotations > 0) parts.push(t(lang, "count.annotations", { count: c.annotations }));
  return parts.join(" · ");
}

/** Wann zuletzt geändert, grob: „gerade eben“, „vor 5 Min.“, „vor 2 Std.“, „gestern“, „vor 3 Tagen“, sonst das Datum. */
export function since(iso: string, now: Date = new Date(), lang: Language = "de"): string {
  const then = new Date(iso);
  const min = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (Number.isNaN(min)) return "";
  if (min < 1) return t(lang, "since.justNow");
  if (min < 60) return t(lang, "since.minutes", { n: min });
  if (min < 6 * 60) return t(lang, "since.hours", { n: Math.floor(min / 60) });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days === 0) return t(lang, "since.today", { time: then.toLocaleTimeString(LOCALES[lang], { hour: "numeric", minute: "2-digit" }) });
  if (days === 1) return t(lang, "since.yesterday");
  if (days < 7) return t(lang, "since.days", { n: days });
  return then.toLocaleDateString(LOCALES[lang], lang === "de" ? { day: "numeric", month: "numeric", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });
}

/** Suche: jedes Wort muss im Titel oder Namen vorkommen, Groß- und Kleinschreibung egal. */
export function matches(c: Pick<CanvasSummary, "title" | "name">, query: string): boolean {
  const hay = `${c.title} ${c.name}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
