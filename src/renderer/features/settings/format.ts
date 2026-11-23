// Beträge für die Anzeige. Jev kostet Bruchteile eines Cents, deshalb unter einem Dollar in US-Cent.
// Deutsch „0,06 ct“ und „1,23 $“, Englisch „0.06¢“ und „$1.23“.

import { LOCALES } from "../../../shared/i18n/index.ts";
import type { Language } from "../../../shared/settings.ts";

const number = (value: number, digits: number, lang: Language) => value.toLocaleString(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatUsd(usd: number, lang: Language = "de"): string {
  const cents = (s: string) => (lang === "en" ? `${s}¢` : `${s} ct`);
  if (usd <= 0) return cents("0");
  const c = usd * 100;
  if (c < 0.01) return `< ${cents(number(0.01, 2, lang))}`;
  if (c < 100) return cents(number(c, 2, lang));
  return lang === "en" ? `$${number(usd, 2, lang)}` : `${number(usd, 2, lang)} $`;
}
