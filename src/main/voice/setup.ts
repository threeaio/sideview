// Was die Spracherkennung braucht und ob es da ist: whisper-server (whisper.cpp), ein Modell und ffmpeg.
// Fehlt etwas, läuft die App ohne Sprache weiter; die Einstellungen zeigen, was fehlt.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SpeechPart = "whisper" | "model" | "ffmpeg";
export type SpeechSetup = { whisper: string | null; model: string | null; ffmpeg: string | null; missing: SpeechPart[] };

/** Bevorzugte Modelle, das erste vorhandene gewinnt; sonst irgendein ggml-*.bin im Ordner. */
export const PREFERRED_MODELS = ["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo-q8_0.bin", "ggml-large-v3-turbo.bin", "ggml-medium.bin", "ggml-small.bin", "ggml-base.bin"];

type Env = { WHISPER_SERVER?: string; WHISPER_MODEL?: string; PATH?: string };
type Fs = { exists(p: string): boolean; list(dir: string): string[] };
const realFs: Fs = {
  exists: (p) => fs.existsSync(p),
  list: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/** Ein Programm im PATH oder an den Orten von Homebrew (aus dem Dock gestartet fehlt Homebrew im PATH). */
export function findProgram(name: string, env: Env = process.env, f: Fs = realFs): string | null {
  const dirs = [...(env.PATH ?? "").split(":").filter(Boolean), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const dir of dirs) {
    const p = path.join(dir, name);
    if (f.exists(p)) return p;
  }
  return null;
}

/** Ordner, in denen Modelle üblicherweise liegen. */
export const modelDirs = (home = os.homedir()) => [path.join(home, ".cache/whisper-cpp"), path.join(home, ".cache/whisper"), "/opt/homebrew/share/whisper-cpp", "/usr/local/share/whisper-cpp"];

export function findModel(env: Env = process.env, home = os.homedir(), f: Fs = realFs): string | null {
  if (env.WHISPER_MODEL) return f.exists(env.WHISPER_MODEL) ? env.WHISPER_MODEL : null;
  for (const dir of modelDirs(home)) {
    const files = f.list(dir);
    const preferred = PREFERRED_MODELS.find((m) => files.includes(m));
    if (preferred) return path.join(dir, preferred);
    const any = files.filter((x) => /^ggml-.+\.bin$/.test(x) && !x.includes("silero")).sort()[0];
    if (any) return path.join(dir, any);
  }
  return null;
}

export function checkSpeech(env: Env = process.env, home = os.homedir(), f: Fs = realFs): SpeechSetup {
  const whisper = env.WHISPER_SERVER ? (f.exists(env.WHISPER_SERVER) ? env.WHISPER_SERVER : null) : findProgram("whisper-server", env, f);
  const model = findModel(env, home, f);
  const ffmpeg = findProgram("ffmpeg", env, f);
  const missing: SpeechPart[] = [];
  if (!whisper) missing.push("whisper");
  if (!model) missing.push("model");
  if (!ffmpeg) missing.push("ffmpeg");
  return { whisper, model, ffmpeg, missing };
}
