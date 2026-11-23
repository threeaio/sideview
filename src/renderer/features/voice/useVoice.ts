// Sprechen: eine Wahltaste (⌥, links oder rechts) halten, überall, auch im Notizfeld. Die Leertaste geht auch, solange kein
// Textfeld aktiv ist; zieht man dabei mit der Maus, verschiebt sie die Fläche, und die Aufnahme fällt weg.
// Loslassen schickt die Aufnahme an den Hauptprozess. Die Entscheidung führt dieser Hook mit den Handlern
// aus, die die Features angemeldet haben. Jede Ausführung kommt ins Protokoll.

import { useCallback, useEffect, useRef, useState } from "react";
import { DICTATE_ID, numberWords, type VoiceDecision, type VoiceNoneReason } from "../../../shared/voice.ts";
import { useT } from "../../shared/i18n.tsx";
import { createRecorder } from "./recorder.ts";
import { useVoiceCommands, voiceSnapshot, type VoiceCommand } from "./registry.ts";
import { voiceService } from "./voice-service.ts";

/** Kürzer gedrückt zählt als Versehen. */
const MIN_HOLD_MS = 250;
/** So lange steht das Ergebnis unten links. */
const SHOW_MS = 4000;
/** So lange gilt eine Rückfrage. */
const ASK_MS = 15000;

export type VoicePhase = "idle" | "listening" | "thinking";
export type VoiceShown =
  | { kind: "done"; transcript: string; label: string }
  | { kind: "dictated"; transcript: string }
  | { kind: "none"; transcript: string; reason: VoiceNoneReason | "no_command" | "microphone" }
  | null;
/** Rückfrage. `dictation`: der gehörte Text, falls eine Wahl „als Text übernehmen“ heißt. */
export type VoiceAsk = { candidates: { id: string; label: string }[]; dictation?: string } | null;

type Trigger = "option" | "space" | "pointer";

/** Beide Wahltasten: Am 5.11. wurde die linke gehalten, angekündigt war nur die rechte. */
const isOption = (e: KeyboardEvent) => e.code === "AltLeft" || e.code === "AltRight";

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
};

/** Sichtbare Knöpfe mit data-option, die kein Befehl abdeckt: Lücke im Grundsatz „jeder Knopf per Sprache“.
 * Unsichtbare zählen nicht, etwa die Knöpfe im geschlossenen Einstellungsdialog. */
function gaps(ids: Set<string>) {
  const missing = [...document.querySelectorAll<HTMLElement>("[data-option]")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.dataset.option!)
    .filter((id) => !ids.has(id));
  return [...new Set(missing)];
}

export function useVoice() {
  const { lang, t } = useT();
  // Sprache und Texte für execute und send, ohne sie neu anzulegen.
  const i18n = useRef({ lang, t });
  i18n.current = { lang, t };
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);
  const [shown, setShown] = useState<VoiceShown>(null);
  const [ask, setAsk] = useState<VoiceAsk>(null);
  const recorder = useRef<ReturnType<typeof createRecorder> | null>(null);
  // Ohne whisper, Modell oder ffmpeg gibt es keine Sprache; alles andere geht weiter.
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  useEffect(() => {
    let live = true;
    void voiceService.ready().then((ok) => {
      if (!live) return;
      readyRef.current = ok;
      setReady(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  const trigger = useRef<Trigger | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;

  recorder.current ??= createRecorder({ onLevel: setLevel });

  // Rückfrage: die Kandidaten sind selbst Befehle, „eins“, „zwei“ oder ein Klick wählt.
  const pick = (index: number) => {
    const current = askRef.current;
    const c = current?.candidates[index];
    setAsk(null);
    if (!c) return;
    if (c.id === DICTATE_ID) {
      const snap = voiceSnapshot();
      if (snap.dictation && current?.dictation) snap.dictation.target.append(current.dictation);
      voiceService.log("executed", { picked: DICTATE_ID, dictation: true, ok: Boolean(snap.dictation) });
      return;
    }
    const cmd = voiceSnapshot().commands.find((x) => x.id === c.id);
    if (cmd) void cmd.run();
  };
  const askCommands: VoiceCommand[] = (ask?.candidates ?? []).map((c, i) => ({
    id: `wahl-${i + 1}`,
    label: `${i + 1}: ${c.label}`,
    meaning: `Choose candidate ${i + 1}: ${c.label}.`,
    phrases: numberWords(i + 1, lang),
    run: () => pick(i),
  }));
  useVoiceCommands("voice", { commands: askCommands });

  useEffect(() => {
    if (!ask) return;
    const timer = setTimeout(() => setAsk(null), ASK_MS);
    return () => clearTimeout(timer);
  }, [ask]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const execute = useCallback(async (decision: VoiceDecision, transcript: string) => {
    const snap = voiceSnapshot();
    if (decision.kind === "command") {
      const cmd = snap.commands.find((c) => c.id === decision.id);
      if (!cmd) {
        setShown({ kind: "none", transcript, reason: "no_command" });
        voiceService.log("executed", { transcript, id: decision.id, ok: false, why: "not_registered" });
        return;
      }
      // Ein Befehl von außerhalb des Notizfelds, etwa „Fertig“: erst die Notiz sichern.
      if (snap.dictation && cmd.source !== snap.dictation.source) await snap.dictation.target.commit();
      setAsk(null);
      await cmd.run(transcript);
      setShown({ kind: "done", transcript, label: cmd.label });
      voiceService.log("executed", { transcript, id: cmd.id, stage: decision.stage, ok: true });
    } else if (decision.kind === "dictation") {
      if (!snap.dictation) return setShown({ kind: "none", transcript, reason: "no_command" });
      if (decision.save) {
        // Schlüsselwort am Ende: anhängen und sichern in einem Schritt.
        await snap.dictation.target.commit(decision.text || undefined);
        setShown({ kind: "done", transcript, label: i18n.current.t("cmd.save.label") });
        voiceService.log("executed", { transcript, dictation: true, saved: true, ok: true });
        return;
      }
      snap.dictation.target.append(decision.text);
      setShown({ kind: "dictated", transcript });
      voiceService.log("executed", { transcript, dictation: true, ok: true });
    } else if (decision.kind === "ask") {
      const candidates = decision.candidates.flatMap((id) => {
        const c = snap.commands.find((x) => x.id === id);
        return c ? [{ id, label: c.label }] : [];
      });
      // Beim Diktat: Befehl oder doch Text? Der Text wird zur zweiten Wahl.
      if (decision.dictation) candidates.push({ id: DICTATE_ID, label: i18n.current.t("voice.asText", { text: decision.dictation }) });
      setAsk(candidates.length >= 2 ? { candidates, dictation: decision.dictation } : null);
      setShown(null);
      voiceService.log("executed", { transcript, ask: candidates.map((c) => c.id), ok: true });
    } else {
      setShown({ kind: "none", transcript, reason: decision.reason });
      voiceService.log("executed", { transcript, none: decision.reason });
    }
  }, []);

  const start = useCallback(async (how: Trigger) => {
    const r = recorder.current!;
    if (trigger.current || !r.supported || !readyRef.current) return;
    trigger.current = how;
    setShown(null);
    setPhase("listening");
    try {
      await r.start();
    } catch (e) {
      trigger.current = null;
      setPhase("idle");
      setShown({ kind: "none", transcript: "", reason: "microphone" });
      voiceService.log("microphone_error", { detail: String(e) });
    }
  }, []);

  /** Aufnahme verwerfen, etwa wenn die Leertaste zum Verschieben gebraucht wird. */
  const abort = useCallback(async () => {
    if (!trigger.current) return;
    trigger.current = null;
    setPhase("idle");
    if (recorder.current!.recording) await recorder.current!.stop();
  }, []);

  /** Aufnahme an den Hauptprozess, mit allem, was man gerade sagen kann, dann ausführen. */
  const send = useCallback(
    async (audio: Uint8Array, mime: string) => {
      setPhase("thinking");
      const snap = voiceSnapshot();
      const missing = gaps(new Set(snap.commands.map((c) => c.id)));
      if (missing.length) {
        console.warn(`Knöpfe ohne Sprachbefehl: ${missing.join(", ")}`);
        voiceService.log("gap", { options: missing });
      }
      try {
        const result = await voiceService.send({
          audio,
          mime,
          context: {
            screen: snap.screen,
            state: snap.state,
            options: snap.commands.map(({ id, meaning, phrases, whileDictating, label, preferred }) => ({ id, meaning, phrases, whileDictating, label, preferred })),
            dictating: snap.dictation !== null,
            pending: askRef.current?.candidates.map((c) => c.id) ?? null,
            language: i18n.current.lang,
          },
        });
        await execute(result.decision, result.transcript);
        return result;
      } finally {
        setPhase("idle");
      }
    },
    [execute],
  );

  const finish = useCallback(async () => {
    if (!trigger.current) return;
    trigger.current = null;
    const r = recorder.current!;
    if (!r.recording) return setPhase("idle");
    const rec = await r.stop();
    if (rec.durationMs < MIN_HOLD_MS || rec.audio.length === 0) return setPhase("idle");
    await send(rec.audio, rec.mime);
  }, [send]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (trigger.current === "option" && !isOption(e)) {
        // ⌥ mit einer anderen Taste, etwa ⌥+L für @: das ist Tippen, keine Aufnahme.
        void abort();
        return;
      }
      if (e.repeat) return;
      if (isOption(e)) {
        e.preventDefault();
        void start("option");
      } else if (e.code === "Space" && !typing() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        void start("space");
      }
    };
    const up = (e: KeyboardEvent) => {
      if ((isOption(e) && trigger.current === "option") || (e.code === "Space" && trigger.current === "space")) void finish();
    };
    // Leertaste und Ziehen heißt Verschieben.
    const pointer = () => {
      if (trigger.current === "space") void abort();
    };
    const blur = () => void abort();
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("blur", blur);
    };
  }, [start, finish, abort]);

  return {
    phase,
    level,
    shown,
    ask,
    pick,
    supported: recorder.current.supported && ready,
    press: () => void start("pointer"),
    release: () => {
      if (trigger.current === "pointer") void finish();
    },
    /** Nur zum Prüfen: eine fertige Aufnahme denselben Weg schicken wie das Mikrofon. */
    inject: send,
  };
}
