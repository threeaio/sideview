// Service der Einstellungen: Schlüsselwörter und Kosten. Ohne React.

import type { Settings } from "../../../shared/settings.ts";
import { bridge } from "../../shared/bridge.ts";

export const settingsKeys = { settings: ["settings"] as const, usage: ["usage"] as const, voice: ["voice-status"] as const };

export const settingsService = {
  get: () => bridge.settings(),
  save: (settings: Settings) => bridge.saveSettings(settings),
  usage: () => bridge.usage(),
  voiceStatus: () => bridge.voiceStatus(),
  setKey: (key: string | null) => bridge.setDecisionKey(key),
  onOpen: bridge.onOpenSettings,
};
