// Jev (TypeSafe System One) wählt einen Befehl, wenn der Code nichts Eindeutiges findet. Übernommen aus
// labs/voice-control (server/jev.mjs, server/choose.mjs). Nur hier wird die API aufgerufen. Der Schlüssel
// kommt aus der Umgebung (TYPESAFE_API_KEY), die Electron-Hülle liest ihn beim Start aus der Keychain.

import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { VoiceContext } from "../../shared/voice.ts";

/** Vorgabe, wenn in den Einstellungen kein Modell steht. */
export const JEV_MODEL = process.env.JEV_MODEL || "jev-1.14.0";

/** Wohin und womit: Adresse leer = api.typesafe.ai; Modell leer = JEV_MODEL. */
export type DecisionCall = { apiKey: string; baseUrl: string; model: string; language: "de" | "en" };
/** Jev nimmt bis zu 255 Optionen in einer choice, eine ist `none`. */
const MAX_OPTIONS = 254;

// Keine pauschalen „Fragen“ hier: Stand dort „a question“, zog Jev lange Sätze nach `none` (24.10.2026).
const NONE_MEANING =
  "No action. The words do not fit any of the listed options: a remark to another person, thinking aloud, small talk, or unintelligible.";

export function buildChoiceRequest(text: string, ctx: VoiceContext, model = JEV_MODEL, language: "de" | "en" = "de") {
  const options = ctx.options.slice(0, MAX_OPTIONS);
  return {
    model,
    state: {
      screen: { description: ctx.screen, state: ctx.state },
      utterance: { text, language, source: "Automatic speech recognition. Small transcription errors are possible." },
    },
    questions: {
      action: {
        type: "choice" as const,
        instructions:
          "The user spoke the words in `utterance.text` while looking at the screen described in `screen`. " +
          "Which of the options does the user want the interface to carry out? Judge by meaning, not by exact words. " +
          "Indirect requests and references such as 'the second one', 'the one about X' or 'go back' count; resolve them with `screen.state`. " +
          "Choose none if the words do not ask for any of these options.",
        criteria: Object.fromEntries([...options.map((o) => [o.id, o.meaning]), ["none", NONE_MEANING]]),
      },
      addressed: {
        type: "noul" as const,
        instructions:
          "Are the words in `utterance.text` a request or instruction directed at the interface, as opposed to a remark to another person, thinking aloud, a question, or noise?",
      },
    },
  };
}

export type JevChoice = { probabilities: Record<string, number>; addressed: number | null; inputTokens: number; ms: number };

let client: { key: string; client: TypeSafeClient } | null = null;

export async function askJev(text: string, ctx: VoiceContext, call: DecisionCall): Promise<JevChoice> {
  // Sprachbefehle sollen schnell scheitern statt lange zu warten. Neuer Client, wenn Schlüssel oder Adresse wechseln.
  const key = `${call.apiKey}|${call.baseUrl}`;
  if (client?.key !== key) client = { key, client: new TypeSafeClient({ apiKey: call.apiKey, ...(call.baseUrl ? { baseURL: call.baseUrl } : {}), timeout: 6000, retry: { maxRetries: 1 } }) };
  const t0 = performance.now();
  // Die Antworttypen des SDK hängen an den Fragetypen; hier reichen die zwei Felder.
  const res = (await client.client.systemOne(buildChoiceRequest(text, ctx, call.model || JEV_MODEL, call.language) as never)) as unknown as {
    answers: { action: { choice: string; probabilities?: Record<string, number> }; addressed?: { noul?: number } };
    usage?: { input_tokens?: number };
  };
  return {
    probabilities: res.answers.action.probabilities ?? { [res.answers.action.choice]: 1 },
    addressed: res.answers.addressed?.noul ?? null,
    inputTokens: res.usage?.input_tokens ?? 0,
    ms: Math.round(performance.now() - t0),
  };
}
