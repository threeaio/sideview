// Transkription mit whisper.cpp, übernommen aus labs/voice-control (server/transcribe.mjs).
// `whisper-server` läuft als Kindprozess und hält das Modell im Speicher. ffmpeg wandelt das Audio
// der Oberfläche in 16-kHz-Mono-WAV. Nur dieses Modul kennt whisper und ffmpeg.

import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
/** Spitzenpegel, unter dem eine Aufnahme als still gilt. Sprache liegt bei -3 bis -25 dB, Rauschen um -50 dB. */
export const SILENT_MAX_DB = -40;
/** Whisper arbeitet in 30-s-Fenstern und verliert an deren Grenze gern einen Satz. Darum selbst schneiden. */
export const MAX_CHUNK_S = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = (url: string) => fetch(url).then(() => true, () => false);

/** Whisper schreibt für Stille und Geräusche Marken wie [BLANK_AUDIO] oder (Musik). Die fliegen raus. */
export const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, "").replace(/\s+/g, " ").trim();

/** Whisper wiederholt manchmal denselben Satz („Fertig. Fertig.“). Gleiche Sätze hintereinander fallen weg. */
export function collapseRepeats(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const out: string[] = [];
  for (const s of sentences) if (!out.length || key(out.at(-1)!) !== key(s)) out.push(s);
  return out.join(" ");
}

/** Schnittpunkte: je Stück die letzte Pause vor der Grenze, sonst hart an der Grenze. */
export function cutPoints(seconds: number, pauses: number[], max = MAX_CHUNK_S): number[] {
  const cuts: number[] = [];
  let start = 0;
  while (seconds - start > max) {
    const inRange = pauses.filter((p) => p > start + 5 && p <= start + max);
    const cut = inRange.length ? inRange[inRange.length - 1]! : start + max;
    cuts.push(cut);
    start = cut;
  }
  return cuts;
}

async function measure(wav: string) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", wav, "-af", "volumedetect", "-f", "null", "-"]);
  const num = (key: string) => {
    const m = stderr.match(new RegExp(`${key}: (-?[\\d.]+) dB`));
    return m ? Number(m[1]) : null;
  };
  const dur = stderr.match(/time=(\d+):(\d+):([\d.]+)/);
  return { meanDb: num("mean_volume"), maxDb: num("max_volume"), seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0 };
}

async function pausesOf(wav: string) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"]);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => (ends[i] != null ? (s + ends[i]!) / 2 : s));
}

/** Die letzten Aufnahmen aufheben, damit man bei Problemen reinhören kann. */
async function stash(dir: string, input: string, ext: string, keep = 20) {
  await mkdir(dir, { recursive: true });
  await copyFile(input, path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`));
  const files = (await readdir(dir)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) await unlink(path.join(dir, f));
}

export type Transcript = { text: string; raw: string; silent: boolean; seconds: number; maxDb: number | null; convertMs: number; whisperMs: number };

export type Whisper = { startupMs: number; transcribe(audio: Uint8Array, ext: string, prompt: string, language?: string): Promise<Transcript>; stop(): void };

export async function startWhisper(opts: { bin?: string; modelPath: string; port: number; threads?: number; language?: string; keepDir?: string | null; log?: (s: string) => void }): Promise<Whisper> {
  const { bin = "whisper-server", modelPath, port, threads = 8, language = "de", keepDir = null, log = () => {} } = opts;
  // Antwortet schon etwas auf dem Port, wäre der Bereit-Test gegen ein fremdes Programm positiv.
  if (await answers(`http://127.0.0.1:${port}/`)) throw new Error(`port_busy:${port}`);
  const child = spawn(bin, ["-m", modelPath, "--host", "127.0.0.1", "--port", String(port), "-t", String(threads), "-l", language, "-nt"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => log(String(d)));
  child.stderr.on("data", (d) => log(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const t0 = performance.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`whisper_exit:${child.exitCode}`);
    if (await answers(base + "/")) break;
    await sleep(150);
    if (performance.now() - t0 > 180_000) {
      child.kill();
      throw new Error("whisper_timeout");
    }
  }

  async function infer(file: string, prompt: string, lang: string) {
    const form = new FormData();
    form.append("file", new Blob([await readFile(file)], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    form.append("language", lang);
    form.append("temperature", "0.0");
    form.append("suppress_non_speech", "true");
    if (prompt) form.append("prompt", prompt);
    const res = await fetch(base + "/inference", { method: "POST", body: form });
    if (!res.ok) throw new Error(`whisper_http:${res.status}`);
    return String(((await res.json()) as { text?: string }).text ?? "");
  }

  async function transcribe(audio: Uint8Array, ext: string, prompt: string, lang = language): Promise<Transcript> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "canvas-voice-"));
    try {
      const input = path.join(dir, `input.${ext}`);
      const wav = path.join(dir, "audio.wav");
      await writeFile(input, audio);
      const t0 = performance.now();
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
      const t1 = performance.now();
      const level = await measure(wav);
      if (keepDir) await stash(keepDir, input, ext);
      const base = { seconds: level.seconds, maxDb: level.maxDb, convertMs: Math.round(t1 - t0) };
      // Praktisch still: Whisper würde Text erfinden („Vielen Dank.“). Gar nicht erst fragen.
      if (level.maxDb != null && level.maxDb < SILENT_MAX_DB) return { text: "", raw: "", silent: true, whisperMs: 0, ...base };
      const cuts = level.seconds > MAX_CHUNK_S ? cutPoints(level.seconds, await pausesOf(wav)) : [];
      const parts: string[] = [];
      if (!cuts.length) parts.push(await infer(wav, prompt, lang));
      else {
        const bounds = [0, ...cuts, level.seconds];
        for (let i = 0; i < bounds.length - 1; i++) {
          const piece = path.join(dir, `part-${i}.wav`);
          await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ss", String(bounds[i]), "-to", String(bounds[i + 1]), "-c", "copy", piece]);
          // Das Ende des vorigen Stücks hält Whisper an der Schnittstelle im Satz.
          const tail = clean(parts.at(-1)).split(" ").slice(-30).join(" ");
          parts.push(await infer(piece, [prompt, tail].filter(Boolean).join(" "), lang));
        }
      }
      const raw = parts.join(" ");
      return { text: collapseRepeats(clean(raw)), raw, silent: false, whisperMs: Math.round(performance.now() - t1), ...base };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Stirbt der Hauptprozess, soll whisper-server nicht als Waise weiterlaufen.
  process.on("exit", () => child.kill("SIGTERM"));
  return { startupMs: Math.round(performance.now() - t0), transcribe, stop: () => child.kill("SIGTERM") };
}
