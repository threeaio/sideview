// Sprache im Hauptprozess: Aufnahme → whisper → Routing (Code, dann Jev) → Entscheidung an die Oberfläche.
// Ausführen tut die Oberfläche, mit denselben Handlern wie die Knöpfe. Jede Äußerung kommt mit allen
// Stufen und Zeiten ins Protokoll `logs/commands.jsonl`.

import path from "node:path";
import { ROOT, config, paths } from "../../shared/config.ts";
import { createLog } from "../../shared/log.ts";
import { DICTATE_OPTION, decideDictation, decideFromJev, routeInCode, type VoiceDecision, type VoiceRequest, type VoiceResult } from "../../shared/voice.ts";
import { extensionGlossaries } from "../extensions.ts";
import { canonical, loadAliases, loadGlossary, whisperPrompt, type Alias } from "./glossary.ts";
import { askJev, JEV_MODEL, type DecisionCall, type JevChoice } from "./jev.ts";
import type { Language } from "../../shared/settings.ts";
import { startWhisper, type Whisper } from "./transcribe.ts";

// Installiert 4731, Entwicklung 4741: Beide Apps haben ihren eigenen Whisper.
const PORT = Number(process.env.CANVAS_WHISPER_PORT || config.port + 11);

const extOf = (mime: string) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

export type Voice = ReturnType<typeof createVoice>;

/** Was die Sprache von außen braucht. Getter, weil Einstellungen sofort gelten, auch für die nächste Äußerung. */
export type VoiceOptions = {
  appLog: (event: string, data: Record<string, unknown>) => void;
  /** whisper-server und Modell, aus checkSpeech (setup.ts). */
  whisperBin: string;
  model: string;
  /** Schlüsselwörter, die eine diktierte Notiz sichern. */
  saveWords?: () => string[];
  language?: () => Language;
  /** Entscheidungsmodell; ohne Schlüssel nur Befehle, die der Code eindeutig erkennt, und Diktat. */
  decision?: () => { apiKey: string | null; baseUrl: string; model: string };
};

export function createVoice({ appLog, whisperBin, model, saveWords = () => [], language = () => "de", decision: backendOf = () => ({ apiKey: process.env.TYPESAFE_API_KEY || null, baseUrl: "", model: "" }) }: VoiceOptions) {
  const log = createLog(path.join(paths.logs(), "commands.jsonl"));
  // Erst bei der ersten Äußerung laden: Bis dahin haben Erweiterungen ihre Einstellungen gesetzt (etwa KB_DIR).
  const glossaryFiles = () => [path.join(ROOT, "config/glossary.json"), ...extensionGlossaries()];
  let glossary: Promise<string[]> | null = null;
  // Schreibweisen, die Whisper für Eigennamen wählt, gleich nach dem Hören richtigstellen.
  let aliases: Promise<Alias[]> | null = null;
  const terms = () => (glossary ??= loadGlossary(glossaryFiles(), process.env.KB_DIR || null).catch(() => [] as string[]));
  const replacements = () => (aliases ??= loadAliases(glossaryFiles()).catch(() => [] as Alias[]));
  // Früh starten: Das Modell zu laden dauert einige Sekunden, die erste Äußerung soll nicht darauf warten.
  const whisper: Promise<Whisper> = startWhisper({ bin: whisperBin, modelPath: model, port: PORT, language: "auto", keepDir: path.join(path.dirname(paths.logs()), "audio") });
  whisper.then(
    (w) => appLog("whisper_ready", { ms: w.startupMs, model: path.basename(model), port: PORT }),
    (e) => appLog("whisper_error", { detail: String(e), model, port: PORT }),
  );

  async function handle({ audio, mime, context }: VoiceRequest): Promise<VoiceResult> {
    const t0 = performance.now();
    const visible = context.options.map((o) => o.label);
    let transcript = "";
    let decision: VoiceDecision;
    let jev: JevChoice | null = null;
    let jevError: string | null = null;
    let tr: Awaited<ReturnType<Whisper["transcribe"]>> | null = null;
    const keywords = saveWords();
    const lang = language();
    const backend = backendOf();
    try {
      // Schlüsselwörter vorn im Glossar, damit Whisper sie so schreibt, wie sie eingetragen sind.
      tr = await (await whisper).transcribe(audio, extOf(mime), whisperPrompt([...keywords, ...(await terms())], visible, lang), lang);
      transcript = canonical(tr.text, await replacements());
    } catch (e) {
      appLog("whisper_error", { detail: String(e) });
    }

    if (!tr) decision = { kind: "none", reason: "whisper_error" };
    else if (tr.silent) decision = { kind: "none", reason: "silent" };
    else {
      const code = routeInCode(transcript, context, keywords);
      if (code.kind !== "jev") decision = code;
      // Ohne Jev geht beim Diktat nichts verloren: dann ist es Text.
      else if (!backend.apiKey) decision = code.dictation ? { kind: "dictation", text: transcript.trim() } : { kind: "none", reason: "no_key" };
      else {
        try {
          if (code.dictation) {
            // Beim Diktat nur die Befehle fürs Notizfeld gegen „Text für die Notiz“.
            const options = [...context.options.filter((o) => o.whileDictating), DICTATE_OPTION];
            jev = await askJev(transcript, { ...context, options }, { ...backend, apiKey: backend.apiKey, language: lang });
            decision = decideDictation(jev.probabilities, context.options, transcript.trim());
          } else {
            jev = await askJev(transcript, context, { ...backend, apiKey: backend.apiKey, language: lang });
            decision = decideFromJev(jev.probabilities, jev.addressed, context.options, code.namesakes);
          }
        } catch (e) {
          jevError = String(e).slice(0, 300);
          decision = code.dictation ? { kind: "dictation", text: transcript.trim() } : { kind: "none", reason: "jev_error" };
        }
      }
    }

    const result: VoiceResult = {
      transcript,
      decision,
      timings: { whisperMs: (tr?.convertMs ?? 0) + (tr?.whisperMs ?? 0), jevMs: jev?.ms ?? 0, totalMs: Math.round(performance.now() - t0) },
    };
    const top = jev ? Object.entries(jev.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3) : null;
    log("utterance", {
      transcript,
      raw: tr?.raw ?? null,
      audio: { bytes: audio.length, mime, seconds: tr?.seconds ?? null, maxDb: tr?.maxDb ?? null },
      dictating: context.dictating,
      pending: context.pending,
      options: context.options.map((o) => o.id),
      decision,
      language: lang,
      jev: jev ? { model: backend.model || JEV_MODEL, ...(backend.baseUrl ? { baseUrl: backend.baseUrl } : {}), ms: jev.ms, inputTokens: jev.inputTokens, top, addressed: jev.addressed } : null,
      jevError,
      timings: result.timings,
    });
    return result;
  }

  return {
    handle,
    log,
    stop: () => void whisper.then((w) => w.stop(), () => {}),
  };
}
