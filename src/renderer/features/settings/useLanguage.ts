// Sprache der Oberfläche aus den Einstellungen; `auto` folgt den bevorzugten Sprachen des Systems.
// Gilt sofort nach dem Speichern: dieselbe Abfrage wie im Einstellungsdialog.

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, resolveLanguage, type Language } from "../../../shared/settings.ts";
import { settingsKeys, settingsService } from "./settings-service.ts";

export function useLanguage(): Language {
  const settings = useQuery({ queryKey: settingsKeys.settings, queryFn: settingsService.get });
  return resolveLanguage((settings.data ?? DEFAULT_SETTINGS).language, navigator.languages);
}
