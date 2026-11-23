// Transport der Sprache: Aufnahme an den Hauptprozess, Protokoll der Ausführung.

import type { VoiceRequest, VoiceResult } from "../../../shared/voice.ts";
import { bridge } from "../../shared/bridge.ts";

export const voiceService = {
  send: (request: VoiceRequest): Promise<VoiceResult> => bridge.voice(request),
  log: (event: string, data: Record<string, unknown>) => void bridge.voiceLog(event, data).catch(() => {}),
  /** Ist die Spracherkennung eingerichtet? Ohne sie bleibt die Sprachleiste weg. */
  ready: () => bridge.voiceStatus().then((s) => s.speech.ready, () => false),
};
