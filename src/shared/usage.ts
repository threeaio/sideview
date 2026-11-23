// Kosten der App: nur Jev kostet, Whisper läuft lokal. Reine Rechnung über die Aufrufe aus logs/commands.jsonl.

/** Preis von Jev je Million Input-Token in US-Dollar, Output kostenlos. Geprüft am 5.11.2026 auf
 * https://docs.typesafe.ai/models.md (jev-1.14.0 und jev-1.13.0 gleich). */
export const JEV_USD_PER_MTOK = 0.042;

export type JevCall = { at: string; inputTokens: number };

/** Beträge in US-Dollar. `perDay`: Mittel über alle Kalendertage seit dem ersten Aufruf, Tage ohne Aufruf zählen mit. */
export type UsageSummary = { today: number; perDay: number; month: number; calls: number; since: string | null; usdPerMtok: number };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Heute, Mittel je Tag und laufender Monat, nach Ortszeit. */
export function summarizeUsage(calls: JevCall[], now: Date, usdPerMtok = JEV_USD_PER_MTOK): UsageSummary {
  const usd = (tokens: number) => (tokens / 1_000_000) * usdPerMtok;
  const valid = calls.filter((c) => Number.isFinite(c.inputTokens) && !Number.isNaN(Date.parse(c.at)));
  let today = 0;
  let month = 0;
  let all = 0;
  let first: Date | null = null;
  for (const c of valid) {
    const at = new Date(c.at);
    if (!first || at < first) first = at;
    all += c.inputTokens;
    if (dayKey(at) === dayKey(now)) today += c.inputTokens;
    if (at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()) month += c.inputTokens;
  }
  const days = first ? Math.max(1, Math.round((startOfDay(now).getTime() - startOfDay(first).getTime()) / 86_400_000) + 1) : 1;
  return { today: usd(today), perDay: first ? usd(all) / days : 0, month: usd(month), calls: valid.length, since: first?.toISOString() ?? null, usdPerMtok };
}

/** Aufrufe aus den Zeilen von commands.jsonl; Zeilen ohne Jev-Aufruf fallen weg. */
export function jevCallsFromLog(text: string): JevCall[] {
  const calls: JevCall[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"inputTokens"')) continue;
    try {
      const row = JSON.parse(line) as { at?: string; jev?: { inputTokens?: number } | null };
      if (row.at && typeof row.jev?.inputTokens === "number") calls.push({ at: row.at, inputTokens: row.jev.inputTokens });
    } catch {
      // halbe Zeile: überspringen
    }
  }
  return calls;
}
