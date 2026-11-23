// Gibt allen Features die Sprache aus den Einstellungen und setzt sie am Dokument (lang).

import { useEffect, type ReactNode } from "react";
import { useLanguage } from "../features/settings/index.ts";
import { LanguageContext } from "../shared/i18n.tsx";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useLanguage();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <LanguageContext.Provider value={lang}>{children}</LanguageContext.Provider>;
}
