// Öffnen ohne Aufblitzen (23.11., sein Befund im Film: „da flickert einmal der Content riesengroß rein“):
// Legt der Agent Bilder auf, darf kein Bild sichtbar sein, bevor die Kamera auf der Übersicht steht. Gemessen je
// Animationsschritt im Renderer: Ist die Fläche sichtbar (kein data-switching) und sind Bilder geladen, muss der
// Zoom schon der endgültige sein. Zwei Fälle: erstes Canvas aus der Startansicht, Wechsel auf ein zweites Canvas.
// Aufruf: npm run check:open

import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = "4797";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-open-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "en", decision: { baseUrl: "", model: "" } }));
const fixture = path.join(ROOT, "test/fixtures/page");

const app = await electron.launch({ args: [path.join(ROOT, "src/electron/main.ts")], cwd: ROOT, env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: PORT, CANVAS_QUIET: "1", CANVAS_VOICE: "0" } });
let failed = 0;
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1240, 920));
  await page.waitForSelector(".app", { timeout: 30_000 });
  await sleep(1000);
  const token = fs.readFileSync(path.join(data, "run/api-token"), "utf8").trim();
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
    return res.json();
  };
  const record = () =>
    page.evaluate(() => {
      window.__open = [];
      const tick = () => {
        const s = document.querySelector(".surface");
        const f = window.__surface?.facts();
        if (s && f) window.__open.push({ hidden: s.hasAttribute("data-switching"), z: f.camera.z, images: f.images, at: location.hash, n: window.__open.length });
        if (window.__open.length < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  /** Nur Bilder, in denen schon das neue Canvas in der Adresse steht; davor ist das alte zu Recht zu sehen. */
  const judge = async (name, canvas) => {
    await sleep(2500);
    const frames = (await page.evaluate(() => window.__open)).filter((f) => f.at === `#${canvas}`);
    const final = frames.at(-1).z;
    const bad = frames.filter((f) => !f.hidden && f.images > 0 && Math.abs(f.z - final) / final > 0.02);
    const ok = bad.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${bad.length} sichtbare Bilder mit falscher Kamera von ${frames.length}`, ok ? "" : JSON.stringify(bad.slice(0, 3)));
  };
  const images = (n) => Array.from({ length: n }, (_, i) => ({ path: path.join(fixture, i % 2 ? "mobile.png" : "desktop.png"), title: `Page ${i + 1}` }));

  await record();
  await api("POST", "/api/canvases/first/open", { title: "First", group: "Pages", images: images(3) });
  await judge("erstes Canvas aus der Startansicht", "first");

  await record();
  await api("POST", "/api/canvases/second/open", { title: "Second", images: images(2) });
  await judge("Wechsel auf ein zweites Canvas", "second");
} finally {
  await app.close();
}
console.log(failed ? `${failed} FEHLER` : "alle richtig");
process.exitCode = failed ? 1 : 0;
