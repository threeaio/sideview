// Mikrofon und MediaRecorder, übernommen aus labs/voice-control (features/voice/recorder.ts), gekürzt.
// Das Mikrofon öffnet beim ersten Sprechen und bleibt danach warm, höchstens `keepWarmMs` nach der letzten
// Aufnahme. Grund: Ein Mikrofon neu zu öffnen dauert einige hundert Millisekunden, in denen der Anfang des
// Gesagten verloren geht („Schließen“ wurde so zu „Please“). Ist das Fenster versteckt, wird es freigegeben.
// Ohne Wahl nimmt der Rekorder das eingebaute Mikrofon, nie ein iPhone (Continuity).

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const isPhone = (label: string) => /iphone|ipad|continuity|integrationskamera/i.test(label);
const isBuiltIn = (label: string) => /macbook|built-in|integriert|internal|imac|mac mini|mac studio/i.test(label);

export type Recording = { audio: Uint8Array; mime: string; durationMs: number };

export function createRecorder({ onLevel, keepWarmMs = 120_000 }: { onLevel?: (level: number) => void; keepWarmMs?: number } = {}) {
  const mimeType = CANDIDATES.find((t) => window.MediaRecorder?.isTypeSupported(t)) ?? "";
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let audioContext: AudioContext | null = null;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  let coolTimer: ReturnType<typeof setTimeout> | undefined;

  const stopLevel = () => {
    clearInterval(levelTimer);
    levelTimer = undefined;
  };

  function release() {
    stopLevel();
    clearTimeout(coolTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !recorder) release();
  });

  async function builtInId(): Promise<string | null> {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default");
    return (devices.find((d) => isBuiltIn(d.label)) ?? devices.find((d) => !isPhone(d.label)))?.deviceId ?? null;
  }

  async function ensureStream(): Promise<MediaStream> {
    if (stream?.getAudioTracks().some((t) => t.readyState === "live")) return stream;
    release();
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
    // Gerätenamen gibt es erst nach der Erlaubnis; beim allerersten Mal also das Standardgerät.
    const id = await builtInId().catch(() => null);
    if (id) audio.deviceId = { exact: id };
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    return stream;
  }

  function watchLevel(s: MediaStream) {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(s).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      onLevel?.(Math.sqrt(sum / data.length));
    }, 60);
  }

  return {
    supported: Boolean(mimeType && navigator.mediaDevices?.getUserMedia),
    get recording() {
      return recorder !== null;
    },

    async start() {
      clearTimeout(coolTimer);
      const s = await ensureStream();
      watchLevel(s);
      chunks = [];
      recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.start();
      startedAt = performance.now();
    },

    stop(): Promise<Recording> {
      return new Promise((resolve) => {
        const r = recorder;
        const finish = async () => {
          const mime = r?.mimeType || mimeType || "audio/webm";
          const audio = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
          const durationMs = r ? performance.now() - startedAt : 0;
          stopLevel();
          recorder = null;
          clearTimeout(coolTimer);
          coolTimer = setTimeout(release, keepWarmMs);
          resolve({ audio, mime, durationMs });
        };
        if (!r || r.state === "inactive") return void finish();
        r.onstop = () => void finish();
        r.stop();
      });
    },

    release,
  };
}
