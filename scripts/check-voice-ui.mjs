// Sprachbefehle der Oberfläche in der echten App, ohne Mikrofon und ohne whisper: Die App nimmt mit einem
// Fake-Mikrofon auf (Option halten), statt whisper liefert diese Prüfung einen festen Satz. Den Befehl dazu bestimmt
// derselbe Code wie in der App (routeInCode) über die Optionen, die die Oberfläche gerade meldet. Geprüft (24.11.):
//   V1 „runter“, „nach rechts“ schwenken das Canvas
//   V2 „Alpha umbenennen“ öffnet das Namensfeld, Gesagtes ersetzt den Namen, „sichern“ übernimmt
//   V3 „Gruppe umbenennen“ ohne Namen nimmt die Gruppe im Blick
//   V4 im Vergleich: „Fassung eins“ zeigt links Fassung 1
//   V5 im Vergleich: ein Bereich („How it works“) fährt beide Hälften hin
//   V6 im Vergleich: „Anmerkung eins“ holt ihre Fassung nach links und fährt hin
// Aufruf: npm run check:voice-ui

import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeInCode } from "../src/shared/voice.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = "4799";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-voice-ui-"));
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "de", decision: { baseUrl: "", model: "" } }));
const fixture = path.join(ROOT, "test/fixtures/page");
const v1 = path.join(data, "seite-v1.png");
const v2 = path.join(data, "seite-v2.png");
fs.copyFileSync(path.join(fixture, "desktop.png"), v1);
fs.copyFileSync(path.join(fixture, "mobile.png"), v2);
// Die aktuelle Fassung bekommt ihre Bereiche: regions.json daneben, mit absolutem Pfad wie bei page-shots.
const v3 = path.join(data, "seite-v3.png");
fs.copyFileSync(path.join(fixture, "desktop.png"), v3);
const regions = JSON.parse(fs.readFileSync(path.join(fixture, "regions.json"), "utf8"));
fs.writeFileSync(path.join(data, "regions.json"), JSON.stringify({ ...regions, views: { desktop: { ...regions.views.desktop, image: v3 } } }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, facts = {}) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`, JSON.stringify(facts));
};

const app = await electron.launch({
  args: [path.join(ROOT, "src/electron/main.ts"), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  cwd: ROOT,
  env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: PORT, CANVAS_QUIET: "1", CANVAS_VOICE: "0" },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app", { timeout: 30_000 });
  // Erst wenn die App ihre Kanäle angemeldet hat: Sprache „eingerichtet“ melden und die Äußerung von hier beantworten.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("voice:status");
    ipcMain.handle("voice:status", () => ({ speech: { ready: true, missing: [], model: "fake" }, key: "none", language: "de" }));
    ipcMain.removeHandler("voice:utterance");
    ipcMain.handle("voice:utterance", (_e, request) => new Promise((resolve) => (globalThis.__utterance = { context: request.context, resolve })));
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.reload();
  await page.waitForSelector(".app", { timeout: 30_000 });
  await sleep(800);
  const token = fs.readFileSync(path.join(data, "run/api-token"), "utf8").trim();
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  };

  /** Option halten, „sprechen“, loslassen; `decision` überschreibt den Code (etwa für Diktat, das sonst Jev entscheidet). */
  const say = async (transcript, decision) => {
    await page.keyboard.down("Alt");
    await sleep(400);
    await page.keyboard.up("Alt");
    let context = null;
    for (let i = 0; i < 50 && !context; i++) {
      context = await app.evaluate(() => globalThis.__utterance?.context ?? null);
      if (!context) await sleep(100);
    }
    if (!context) throw new Error(`keine Aufnahme für „${transcript}“`);
    const d = decision ?? routeInCode(transcript, context);
    // Was der Code nicht entscheidet, ginge in der App an Jev; hier ist das ein Fehler der Prüfung.
    if (d.kind === "jev") throw new Error(`„${transcript}“ trifft keinen Befehl: ${context.options.map((o) => o.id).join(", ")}`);
    await app.evaluate((_e, result) => {
      globalThis.__utterance.resolve(result);
      globalThis.__utterance = null;
    }, { transcript, decision: d, timings: { whisperMs: 0, jevMs: 0, totalMs: 0 } });
    await sleep(1200);
    return d;
  };
  const cam = () => page.evaluate(() => window.__surface?.facts().camera);
  const compare = () => page.evaluate(() => window.__compare?.facts() ?? null);

  // Ein Canvas mit Gruppe Alpha (zwei Bilder) und Gruppe Beta (ein Bild).
  await api("POST", "/api/canvases/gruppen/open", { title: "Gruppen", group: "Alpha", images: [{ path: v1, title: "A1" }, { path: v2, title: "A2" }] });
  await api("POST", "/api/canvases/gruppen/open", { group: "Beta", images: [{ path: v2, title: "B1" }] });
  await sleep(2500);

  const c0 = await cam();
  const down = await say("runter");
  const c1 = await cam();
  check("V1 „runter“ schwenkt nach unten", down.kind === "command" && down.id === "runter" && c1.y > c0.y + 50 / c0.z && Math.abs(c1.x - c0.x) < 1, { down, c0, c1 });
  await say("nach rechts");
  const c2 = await cam();
  check("V1 „nach rechts“ schwenkt nach rechts", c2.x > c1.x + 50 / c1.z && Math.abs(c2.y - c1.y) < 1, { c1, c2 });

  const rename = await say("Alpha umbenennen");
  const field = await page.$eval(".group-name-editor__field", (e) => e.value).catch(() => null);
  check("V2 „Alpha umbenennen“ öffnet das Namensfeld", rename.id === "gruppe-umbenennen-0" && field === "Alpha", { rename, field });
  await say("Kundenstimmen.", { kind: "dictation", text: "Kundenstimmen." });
  const typed = await page.$eval(".group-name-editor__field", (e) => e.value).catch(() => null);
  check("V2 Gesagtes ersetzt den Namen, ohne Punkt", typed === "Kundenstimmen", { typed });
  const save = await say("sichern");
  const groups = (await api("GET", "/api/canvases/gruppen")).groups.map((g) => g.title);
  const open = await page.$(".group-name-editor__field");
  check("V2 „sichern“ übernimmt den Namen", save.id === "gruppenname-sichern" && groups.includes("Kundenstimmen") && !open, { save, groups });

  // Gruppe Beta in den Blick, dann ohne Namen umbenennen.
  await say("Beta");
  const here = await say("Gruppe umbenennen");
  const beta = await page.$eval(".group-name-editor__field", (e) => e.value).catch(() => null);
  check("V3 „Gruppe umbenennen“ nimmt die Gruppe im Blick", here.id === "gruppe-umbenennen" && beta === "Beta", { here, beta });
  await say("verwerfen");
  check("V3 „verwerfen“ schließt das Feld, Name bleibt", !(await page.$(".group-name-editor__field")) && (await api("GET", "/api/canvases/gruppen")).groups.some((g) => g.title === "Beta"));

  // Vergleich: drei Fassungen, Anmerkung auf Fassung 1.
  const opened = await api("POST", "/api/canvases/vergleich/open", { title: "Vergleich", images: [{ path: v1, title: "Seite" }] });
  const item = opened.canvas?.items?.[0] ?? (await api("GET", "/api/canvases/vergleich")).items[0];
  await sleep(1500);
  await page.evaluate(({ itemId }) => window.canvasBridge.invoke("annotation:add", "vergleich", { itemId, rect: [100, 2600, 500, 200], note: "Schritte zu eng", source: "text" }), { itemId: item.id });
  await sleep(300);
  await api("POST", "/api/canvases/vergleich/open", { images: [{ path: v2, replaces: item.id }] });
  await sleep(300);
  await api("POST", "/api/canvases/vergleich/open", { images: [{ path: v3, replaces: item.id }] });
  await sleep(2500);
  await say("Fassungen vergleichen");
  for (let i = 0; i < 80; i++) {
    const f = await compare();
    if (f?.ready && f.settled) break;
    await sleep(100);
  }
  const label = () => page.$$eval(".compare__version", (els) => els.map((e) => e.textContent));
  check("V4 Vergleich offen, links Fassung 2", (await label())[0] === "Fassung 2 von 3", { labels: await label() });
  const one = await say("Fassung eins");
  check("V4 „Fassung eins“ zeigt links Fassung 1", one.id === "vergleich-fassung-1" && (await label())[0] === "Fassung 1 von 3", { one, labels: await label() });
  await say("Fassung zwei");

  const before = (await compare()).cameras[1];
  const region = await say("How it works");
  const after = (await compare()).cameras;
  // Bereich „How it works“ beginnt bei y = 2020 (Bildpixel, Breite 1440 = Weltmaß).
  check("V5 Bereich fährt beide Hälften hin", region.id === "vergleich-bereich-2" && after[1].y > before.y + 1000 && Math.abs(after[0].y - after[1].y) < 0.01, { region, before, after });

  await say("Kopf");
  const note = await say("Anmerkung eins");
  const atNote = (await compare()).cameras[1];
  const labels = await label();
  const marks = await page.$$eval(".compare__pane", (ps) => ps.map((p) => p.querySelectorAll(".mark").length));
  check("V6 „Anmerkung eins“ holt Fassung 1 nach links und fährt hin", note.id === "vergleich-anmerkung-1" && labels[0] === "Fassung 1 von 3" && atNote.y > 2000 && marks[0] === 1, { note, labels, atNote, marks });
} finally {
  await app.close();
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(failed ? `${failed} Fehler` : "alle richtig");
process.exit(failed ? 1 : 0);
