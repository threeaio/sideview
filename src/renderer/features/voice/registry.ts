// Was man gerade sagen kann. Jedes Feature meldet seine Befehle mit denselben Handlern wie seine Knöpfe an
// (Option-ID = data-option des Knopfs). Ist ein Notizfeld offen, meldet es sich als Diktatziel.
// Gelesen wird erst, wenn eine Äußerung kommt; deshalb ein schlichter Speicher ohne Neuzeichnen.

import { useEffect } from "react";
import type { VoiceOption } from "../../../shared/voice.ts";

export type VoiceCommand = VoiceOption & {
  /** `transcript`: das Gesagte, etwa für „Suche nach Plakaten“, wo der Rest der Suchbegriff ist. */
  run: (transcript?: string) => void | Promise<void>;
  /** Wird erst beim Sprechen gefragt, etwa ob das Bild dieses Bereichs gerade im Blick ist. */
  prefer?: () => boolean;
};

/** Offenes Notizfeld: Gesagtes anhängen; vor einem fremden Befehl erst sichern. `commit(spoken)` hängt an und sichert in einem Schritt. */
export type DictationTarget = { append(text: string): void; commit(spoken?: string): Promise<void> };

export type VoiceSource = {
  commands: VoiceCommand[];
  dictation?: DictationTarget | null;
  /** Beschreibung der Ansicht und ihr Zustand für Jev. */
  screen?: { description: string; state: Record<string, unknown> };
};

const sources = new Map<string, VoiceSource>();

/** Bei jedem Rendern neu eintragen: Die Handler sehen so immer den neuesten Stand. */
export function useVoiceCommands(name: string, source: VoiceSource) {
  useEffect(() => {
    sources.set(name, source);
  });
  useEffect(
    () => () => {
      sources.delete(name);
    },
    [name],
  );
}

export function voiceSnapshot() {
  const all = [...sources.entries()];
  const commands = all.flatMap(([name, s]) => s.commands.map((c) => ({ ...c, preferred: c.prefer ? c.prefer() : c.preferred, source: name })));
  const dictating = all.find(([, s]) => s.dictation);
  const screens = all.flatMap(([, s]) => (s.screen ? [s.screen] : []));
  return {
    commands,
    dictation: dictating ? { source: dictating[0], target: dictating[1].dictation! } : null,
    screen: screens.map((s) => s.description).join(" "),
    state: Object.assign({}, ...screens.map((s) => s.state)) as Record<string, unknown>,
  };
}
