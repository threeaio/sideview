import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSpeech, findModel } from "./setup.ts";

const fakeFs = (files: string[]) => ({
  exists: (p: string) => files.includes(p),
  list: (dir: string) => files.filter((f) => f.startsWith(dir + "/")).map((f) => f.slice(dir.length + 1)),
});

test("Sprache: alles da über Homebrew und Modell im Cache", () => {
  const f = fakeFs(["/opt/homebrew/bin/whisper-server", "/opt/homebrew/bin/ffmpeg", "/h/.cache/whisper-cpp/ggml-base.bin", "/h/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin"]);
  const s = checkSpeech({ PATH: "/usr/bin" }, "/h", f);
  assert.deepEqual(s.missing, []);
  assert.equal(s.model, "/h/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
});

test("Sprache: frischer Rechner ohne alles meldet alle drei Teile", () => {
  assert.deepEqual(checkSpeech({ PATH: "/usr/bin" }, "/h", fakeFs([])).missing, ["whisper", "model", "ffmpeg"]);
});

test("Modell: Umgebung gewinnt, fehlt die Datei, gilt es als fehlend; sonst irgendein ggml-Modell, nie silero", () => {
  assert.equal(findModel({ WHISPER_MODEL: "/x/m.bin" }, "/h", fakeFs(["/x/m.bin"])), "/x/m.bin");
  assert.equal(findModel({ WHISPER_MODEL: "/x/m.bin" }, "/h", fakeFs(["/h/.cache/whisper-cpp/ggml-base.bin"])), null);
  assert.equal(findModel({}, "/h", fakeFs(["/h/.cache/whisper-cpp/ggml-silero-v5.bin", "/h/.cache/whisper-cpp/ggml-tiny.en.bin"])), "/h/.cache/whisper-cpp/ggml-tiny.en.bin");
});
