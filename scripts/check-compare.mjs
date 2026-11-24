// Fassungsvergleich (23.11.: „nebeneinander, ohne Schieberegler“) in der echten App, eigene Datenablage, kein
// sichtbares Fenster nötig. Ein Bild wird zweimal ersetzt (drei Fassungen, verschiedene Breiten); vor dem ersten
// Tausch entsteht eine Anmerkung. Geprüft:
//   C1 die Zahl an der Marke öffnet den Vergleich, beide Hälften zeigen ihr Bild und stehen gleich
//   C2 Scrollen in der linken und Zoomen in der rechten Hälfte bewegen beide gleich
//   C3 links steht die Fassung vor der aktuellen, Pfeil links blättert zur ältesten; die Stelle bleibt
//   C4 die Anmerkung erscheint nur auf der Fassung, auf der sie entstand
//   C5 Tasten der Fläche (M, Pfeile) wirken nicht durch; Esc schließt, die Werkzeugleiste kommt zurück
//   C6 Rahmen folgt der Kamera seiner Hälfte, auch wenn sich die Fläche darunter bewegt
//   C7 Fassung löschen (Knopf, Löschtaste) samt Anmerkungen, Rückgängig über dem Vergleich
//   C8 Fassung löschen über die Schnittstelle des MCP-Werkzeugs
// Aufruf: npm run check:compare [ordner für Bilder]

import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = "4795";
const NAME = "compare";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-compare-"));
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "de", decision: { baseUrl: "", model: "" } }));
const fixture = path.join(ROOT, "test/fixtures/page");
const v1 = path.join(data, "seite-v1.png");
const v2 = path.join(data, "seite-v2.png");
const v3 = path.join(data, "seite-v3.png");
fs.copyFileSync(path.join(fixture, "desktop.png"), v1);
fs.copyFileSync(path.join(fixture, "mobile.png"), v2);
fs.copyFileSync(path.join(fixture, "desktop.png"), v3);
const out = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (out) fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, facts = {}) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`, JSON.stringify(facts));
};
const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) / b.z < 1e-6;

const app = await electron.launch({ args: [path.join(ROOT, "src/electron/main.ts")], cwd: ROOT, env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: PORT, CANVAS_QUIET: "1", CANVAS_VOICE: "0" } });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.waitForSelector(".app", { timeout: 30_000 });
  await sleep(800);
  const token = fs.readFileSync(path.join(data, "run/api-token"), "utf8").trim();
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  };
  const shot = async (name) => out && page.screenshot({ path: path.join(out, `${name}.png`) });
  const compare = () => page.evaluate(() => window.__compare?.facts() ?? null);
  const settled = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const f = await compare();
      if (f?.ready && f.settled) return f;
      await sleep(100);
    }
    return compare();
  };

  const opened = await api("POST", `/api/canvases/${NAME}/open`, { title: "Vergleich", images: [{ path: v1, title: "Seite" }] });
  const item = opened.canvas?.items?.[0] ?? (await api("GET", `/api/canvases/${NAME}`)).items[0];
  await sleep(1500);
  // Anmerkung auf Fassung 1, oben links im Kopf.
  await page.evaluate(({ canvas, itemId }) => window.canvasBridge.invoke("annotation:add", canvas, { itemId, rect: [100, 80, 500, 200], note: "Kopf zu laut", source: "text" }), { canvas: NAME, itemId: item.id });
  await sleep(300);
  await api("POST", `/api/canvases/${NAME}/open`, { images: [{ path: v2, replaces: item.id }] });
  await sleep(300);
  await api("POST", `/api/canvases/${NAME}/open`, { images: [{ path: v3, replaces: item.id }] });
  await page.waitForFunction(() => document.querySelector(".surface-title__versions")?.textContent === "3", null, { timeout: 15_000 });
  await sleep(800);

  // C1
  const canvasCamAtOpen = await page.evaluate(() => window.__surface.facts().camera);
  await page.click(".surface-title__versions");
  let f = await settled();
  check("C1 Vergleich offen, beide Hälften mit Bild", Boolean(f?.ready) && f.images[0] === 1 && f.images[1] === 1, { f });
  check("C1 beide Hälften gleich groß und gleich gestellt", f && same(f.cameras[0], f.cameras[1]) && Math.abs(f.viewports[0].w - f.viewports[1].w) <= 1, { f });
  const labels = await page.$$eval(".compare__version", (els) => els.map((e) => e.textContent));
  check("C3 links Fassung 2, rechts die aktuelle", labels[0] === "Fassung 2 von 3" && labels[1] === "Fassung 3 von 3", { labels });
  await shot("c1-offen");

  // C2
  const panes = await page.$$(".compare__pane");
  const box0 = await panes[0].boundingBox();
  const box1 = await panes[1].boundingBox();
  const before = f.cameras[0];
  await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await page.mouse.wheel(0, 600);
  await sleep(200);
  f = await compare();
  check("C2 Scrollen links bewegt beide", f.cameras[0].y > before.y + 100 && same(f.cameras[0], f.cameras[1]), { before, after: f.cameras });
  const ghost = await page.evaluate(() => document.querySelectorAll(".compare__ghost")[1].hasAttribute("data-on"));
  check("C2 Zeiger erscheint als Ring in der anderen Hälfte", ghost);
  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 3);
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -10);
  await page.keyboard.up("Control");
  await sleep(200);
  const zoomed = await compare();
  check("C2 Zoomen rechts zoomt beide", zoomed.cameras[0].z > f.cameras[0].z * 1.5 && same(zoomed.cameras[0], zoomed.cameras[1]), { before: f.cameras[0], after: zoomed.cameras });
  // C6 (23.11., sein Test: Rahmen und Bild gegeneinander verrutscht): Der Rahmen jeder Hälfte sitzt dort, wo ihre
  // Kamera das Bild zeichnet, und die Fläche darunter bewegt sich nicht mit. Danach die Fläche darunter selbst
  // bewegen: der Vergleich darf davon nichts merken.
  const frames = () => page.$$eval(".compare__pane", (ps) => ps.map((p) => {
    const r = p.getBoundingClientRect();
    const b = p.querySelector(".surface-frame").getBoundingClientRect();
    return { x: b.left - r.left, y: b.top - r.top };
  }));
  const fits = (fr, cams) => fr.every((p, k) => Math.abs(p.x + cams[k].x * cams[k].z) <= 1 && Math.abs(p.y + cams[k].y * cams[k].z) <= 1);
  await sleep(300);
  let fr = await frames();
  check("C6 Rahmen sitzt nach Scrollen und Zoomen genau auf dem Bild", fits(fr, zoomed.cameras), { fr, cams: zoomed.cameras });
  const mainCam = await page.evaluate(() => window.__surface.facts().camera);
  check("C6 Scrollen im Vergleich bewegt die Fläche darunter nicht", same(mainCam, canvasCamAtOpen), { mainCam, canvasCamAtOpen });
  await page.mouse.move(box0.x + 200, box0.y + 400);
  await page.mouse.down();
  await page.mouse.move(box0.x + 260, box0.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.mouse.dblclick(box1.x + 300, box1.y + 500);
  await sleep(900);
  const mainCam2 = await page.evaluate(() => window.__surface.facts().camera);
  check("C6 Ziehen und Doppelklick im Vergleich bewegen die Fläche darunter nicht", same(mainCam2, canvasCamAtOpen), { mainCam2, canvasCamAtOpen });
  await page.evaluate(() => {
    const c = window.__surface.facts().camera;
    window.__surface.jumpTo({ ...c, x: c.x + 300, y: c.y + 200 });
  });
  await sleep(300);
  fr = await frames();
  check("C6 Bewegt sich die Fläche darunter, bleibt der Rahmen", fits(fr, (await compare()).cameras), { fr });

  // C3
  const beforeStep = (await settled()).cameras[0];
  await page.keyboard.press("ArrowLeft");
  await sleep(300);
  f = await settled();
  const left = await page.$eval(".compare__version", (e) => e.textContent);
  check("C3 Pfeil links zeigt die älteste Fassung", left === "Fassung 1 von 3", { left });
  check("C3 die Stelle bleibt beim Blättern", same(f.cameras[0], beforeStep) && same(f.cameras[0], f.cameras[1]), { before: beforeStep, after: f.cameras });

  // C4
  const marks = await page.$$eval(".compare__pane", (ps) => ps.map((p) => p.querySelectorAll(".mark").length));
  check("C4 Anmerkung nur auf Fassung 1", marks[0] === 1 && marks[1] === 0, { marks });
  await page.keyboard.press("Shift+Digit1");
  await sleep(1300);
  await shot("c4-aelteste");
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  const marks2 = await page.$$eval(".compare__pane", (ps) => ps.map((p) => p.querySelectorAll(".mark").length));
  check("C4 auf Fassung 2 keine", marks2[0] === 0 && marks2[1] === 0, { marks2 });

  // C7 (23.11.: „Fassung löschen gerne auch direkt machen“) Knopf löscht die Fassung links, „Rückgängig“ steht über
  // dem Vergleich und bringt sie zurück; die Löschtaste löscht Fassung 1 samt der Anmerkung, die auf ihr entstand.
  const labelsNow = () => page.$$eval(".compare__version", (els) => els.map((e) => e.textContent));
  const notesNow = async () => (await api("GET", `/api/canvases/${NAME}`)).annotations.length;
  await page.click('[data-option="fassung-loeschen"]');
  await page.waitForFunction(() => document.querySelector(".compare__version")?.textContent === "Fassung 1 von 2", null, { timeout: 5000 }).catch(() => {});
  const afterDelete = await labelsNow();
  const toastOnTop = await page.evaluate(() => {
    const t = document.querySelector(".undo-toast__action");
    if (!t) return false;
    const b = t.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(".undo-toast") !== null;
  });
  check("C7 Knopf löscht Fassung 2, links rückt Fassung 1 nach", afterDelete[0] === "Fassung 1 von 2" && afterDelete[1] === "Fassung 2 von 2", { afterDelete });
  check("C7 Rückgängig steht sichtbar über dem Vergleich", toastOnTop);
  await page.click(".undo-toast__action");
  await page.waitForFunction(() => document.querySelectorAll(".compare__version")[1]?.textContent === "Fassung 3 von 3", null, { timeout: 5000 }).catch(() => {});
  check("C7 Rückgängig bringt sie zurück", (await labelsNow())[1] === "Fassung 3 von 3", { labels: await labelsNow() });
  await page.keyboard.press("ArrowLeft");
  await sleep(200);
  const notesBefore = await notesNow();
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll(".compare__version")[1]?.textContent === "Fassung 2 von 2", null, { timeout: 5000 }).catch(() => {});
  const notesAfter = await notesNow();
  check("C7 Löschtaste löscht Fassung 1 samt ihrer Anmerkung", notesBefore === 1 && notesAfter === 0 && (await labelsNow())[1] === "Fassung 2 von 2", { notesBefore, notesAfter, labels: await labelsNow() });
  await page.click(".undo-toast__action");
  await page.waitForFunction(() => document.querySelectorAll(".compare__version")[1]?.textContent === "Fassung 3 von 3", null, { timeout: 5000 }).catch(() => {});
  check("C7 Rückgängig bringt Fassung und Anmerkung zurück", (await notesNow()) === 1 && (await labelsNow())[1] === "Fassung 3 von 3", { notes: await notesNow(), labels: await labelsNow() });

  // C5
  const tool = () => page.$eval(".surface", (s) => s.getAttribute("data-tool"));
  const toolBefore = await tool();
  const canvasCam = await page.evaluate(() => window.__surface.facts().camera);
  await page.keyboard.press("m");
  await page.keyboard.press("ArrowRight");
  await sleep(200);
  const canvasCamAfter = await page.evaluate(() => window.__surface.facts().camera);
  check("C5 M und Pfeile wirken nicht auf die Fläche darunter", (await tool()) === toolBefore && same(canvasCam, canvasCamAfter), { toolBefore, tool: await tool() });
  await page.keyboard.press("Escape");
  await sleep(300);
  const closed = await page.evaluate(() => ({ compare: Boolean(document.querySelector(".compare")), toolbar: Boolean(document.querySelector(".toolbar")) }));
  check("C5 Esc schließt, Werkzeugleiste wieder da", !closed.compare && closed.toolbar, closed);

  // C8 Über die Schnittstelle (für das MCP-Werkzeug): Fassung 2 von Bild 1 löschen.
  const viaApi = await api("POST", `/api/canvases/${NAME}/remove-versions`, { image: "1", versions: [2] });
  const left2 = viaApi.canvas.items[0].versions?.map((v) => path.basename(v.path));
  check("C8 Schnittstelle löscht Fassung 2", JSON.stringify(left2) === JSON.stringify(["seite-v1.png"]), { left2 });
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/canvases/${NAME}/remove-versions`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ image: "1", versions: [5] }) });
  check("C8 unbekannte Fassung: Fehler, nichts gelöscht", bad.status === 404 && (await api("GET", `/api/canvases/${NAME}`)).items[0].versions?.length === 1, { status: bad.status });
} finally {
  await app.close();
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(failed ? `${failed} FEHLER` : "alle richtig");
process.exitCode = failed ? 1 : 0;
