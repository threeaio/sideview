// Stresstest der Beschriftungen in der echten App (verborgenes Fenster, eigener Datenordner): Nummern, Notizen,
// Knöpfe und Bildmarken dürfen sich in keiner Zoomstufe und keiner Lage überlagern (23.11.: „die 50 wird überlagert“,
// „43 Erledigt Löschen unter dem Bildnamen wirkt unruhig“). Ein Canvas mit kurzen, langen und vielen Notizen, Rahmen
// an allen Kanten, Punkten, winzigen Rahmen, Erledigten mit Antwort, kleinen und breiten Bildern in einer Gruppe.
// Je Bild sechs Zoomstufen und drei Lagen (ganz im Bild, oben abgeschnitten, links abgeschnitten), je Lage ohne
// Auswahl, mit Zeigen auf jede Nummer und mit jeder gewählten Anmerkung. Gemessen wird im DOM:
//   verdeckt   eine Nummer ist an ihrer Stelle nicht das oberste Element (z. B. ein Rahmen liegt darüber)
//   marke      eine Nummer liegt auf einer Bildmarke
//   nummern    zwei Nummern liegen aufeinander
//   karte      die gewählte Karte oder die gezeigte Notiz ragt aus dem Fenster oder unter Kopfzeile/Werkzeugleiste
//   editor     das Notizfeld beim Bearbeiten ragt aus dem Fenster oder liegt auf der Werkzeugleiste
//   karte-marke die gewählte Karte liegt auf der Marke ihres eigenen Bildes (fremde Bilder darf sie überdecken)
// Aufruf: npm run check:labels   Bilder der Fehler: CANVAS_SHOTS=<ordner>.

import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = "4794";
/** Nur Szenen, deren Name passt (CANVAS_ONLY, regulärer Ausdruck), etwa zum Nachstellen eines Fehlers. */
const ONLY = process.env.CANVAS_ONLY ? new RegExp(process.env.CANVAS_ONLY) : null;
/** Fenstergrößen (Inhalt): üblich und klein. */
const SIZES = [[1280, 820], [900, 620]];
const SHOTS = process.env.CANVAS_SHOTS ? path.resolve(process.env.CANVAS_SHOTS) : null;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-labels-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(data, "canvases"));
fs.mkdirSync(path.join(data, "images"));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "de", decision: { baseUrl: "", model: "" } }));

// Bilder: die Seite aus den Fixtures, ein kleines, ein breites, die Handyfassung.
const fixture = path.join(ROOT, "test/fixtures/page");
const img = async (name, w, h, color) => {
  const file = path.join(data, "images", name);
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(file);
  return file;
};
const images = [
  { title: "Seite Desktop", file: path.join(fixture, "desktop.png"), w: 1440, h: 6000 },
  { title: "Kleines Bild", file: await img("small.png", 400, 300, "#3a5a8c"), w: 400, h: 300 },
  { title: "Breites Bild mit sehr langem Namen für die Marke", file: await img("wide.png", 3000, 800, "#c84b31"), w: 3000, h: 800 },
  { title: "Seite Handy", file: path.join(fixture, "mobile.png"), w: 780, h: 12320 },
];

const SHORT = "Kurz";
const MID = "Abstand zur Kopfzeile zu knapp, eine Stufe mehr";
const LONG =
  "Die Überschrift ist auf dem ersten Blick zu klein und konkurriert mit dem Bild daneben. Eine Stufe größer, dafür den Untertitel leiser, und die Schaltfläche näher an den Text. Prüfen, ob das auch in der Handyfassung trägt, dort bricht die Zeile sonst nach zwei Wörtern um.";
const notes = {
  0: [
    [[0, 0, 1440, 800], SHORT],
    [[0, 0, 1440, 2000], LONG],
    [[0, 0, 1440, 400], MID],
    [[10, 10, 200, 100], SHORT],
    [[700, 40, 0, 0], MID],
    [[100, 1200, 600, 400], MID, "Überschrift um 25 % größer gesetzt, Zeilenabstand enger."],
    [[1200, 1500, 240, 300], LONG],
    [[0, 5600, 1440, 400], SHORT],
    [[500, 3000, 20, 20], SHORT],
    [[300, 2500, 400, 300], SHORT],
    [[300, 2500, 400, 300], MID],
    [[300, 2500, 400, 300], LONG],
    [[300, 2500, 400, 300], SHORT],
    [[0, 4000, 300, 500], LONG],
    [[1430, 2000, 10, 10], SHORT],
    [[1100, 0, 340, 200], MID],
  ],
  1: [
    [[0, 0, 400, 300], SHORT],
    [[0, 0, 120, 80], LONG],
    [[200, 150, 0, 0], MID],
  ],
  2: [
    [[0, 0, 3000, 800], MID],
    [[2600, 0, 400, 200], LONG, "Erledigt."],
  ],
  3: [
    [[0, 0, 780, 1600], SHORT],
    [[0, 0, 780, 300], LONG],
    ...Array.from({ length: 10 }, (_, k) => [[40, 2000 + k * 900, 700, 600], k % 3 === 0 ? LONG : k % 3 === 1 ? MID : SHORT]),
  ],
};

// Canvas-Datei: alle Bilder in einer Gruppe nebeneinander.
let x = 0;
const nodes = images.map((im, i) => {
  const id = `img${i}`;
  const node = {
    id,
    type: "file",
    file: im.file,
    x,
    y: 0,
    width: im.w,
    height: im.h,
    canvas: {
      title: im.title,
      origin: { kind: "file", ref: im.file, fetchedAt: "2026-11-23T00:00:00.000Z" },
      imageWidth: im.w,
      imageHeight: im.h,
      scale: 1,
      annotations: notes[i].map(([rect, note, reply], k) => ({
        id: `a${i}-${k}`,
        itemId: id,
        rect,
        note,
        createdAt: "2026-11-23T00:00:00.000Z",
        source: "text",
        ...(reply ? { done: { at: "2026-11-23T00:01:00.000Z", by: "claude", reply } } : {}),
      })),
    },
  };
  x += im.w + 200;
  return node;
});
const group = { id: "grp", type: "group", label: "Stresstest", x: -160, y: -160, width: x + 120, height: 12320 + 320, canvas: { items: nodes.map((n) => n.id) } };
fs.writeFileSync(path.join(data, "canvases/stresstest.canvas"), JSON.stringify({ nodes: [group, ...nodes], edges: [], canvas: { title: "Stresstest", updatedAt: "2026-11-23T00:00:00.000Z" } }));

const app = await electron.launch({ args: [path.join(ROOT, "src/electron/main.ts")], cwd: ROOT, env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: PORT, CANVAS_QUIET: "1", CANVAS_VOICE: "0" } });
const problems = new Map();
let frames = 0;
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
  await page.waitForSelector(".surface", { timeout: 30_000 });
  // Canvas öffnen, falls die App mit einem anderen startet.
  for (let t = 0; t < 100 && !(await page.evaluate(() => document.querySelectorAll(".surface-title").length)); t++) await sleep(100);
  await page.waitForFunction(() => window.__surface?.facts().images > 0, null, { timeout: 30_000 });
  // Zum Messen fangen alle Elemente Klicks, sonst übersieht elementsFromPoint Rahmen ohne pointer-events.
  const measure = () =>
    page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = ".surface * { pointer-events: auto !important; }";
      document.head.append(style);
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const hit = (a, b, pad = 0) => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      const vw = innerWidth;
      const vh = innerHeight;
      const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-height")) || 0;
      const toolbar = document.querySelector(".toolbar");
      const tb = toolbar ? box(toolbar) : null;
      const out = [];
      const numbers = [...document.querySelectorAll(".mark-label__number")].filter(shown).map((el) => ({ el, b: box(el), label: el.closest(".mark-label") }));
      const pills = [...document.querySelectorAll(".surface-title__pill")].filter(shown).map((el) => ({ el, b: box(el) }));
      const onScreen = (b) => b.x + b.w > 0 && b.x < vw && b.y + b.h > barH && b.y < vh;
      for (const n of numbers) {
        if (!onScreen(n.b)) continue;
        const text = n.el.textContent.trim();
        // Oberstes Element an fünf Punkten innerhalb der Nummer.
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) {
          const px = n.b.x + n.b.w * fx;
          const py = n.b.y + n.b.h * fy;
          if (px < 0 || py < 0 || px >= vw || py >= vh) continue;
          const top = document.elementFromPoint(px, py);
          if (!top || n.label.contains(top)) continue;
          const other = top.closest(".mark-label");
          const what = other ? (other.dataset.selected !== undefined ? "gewählte Karte" : "andere Notiz") : top.className || top.tagName;
          // Die gewählte Karte darf über fremden Nummern liegen, ebenso eine gezeigte Notiz.
          if (other && (other.dataset.selected !== undefined || other.matches(":hover"))) continue;
          if (top.closest(".toolbar, .review-bar, .top-bar, .notes, .contents")) continue;
          out.push(["verdeckt", `Nummer ${text} unter ${what}`]);
          break;
        }
        for (const p of pills) if (hit(n.b, p.b, 1)) out.push(["marke", `Nummer ${text} auf „${p.el.textContent.trim().slice(0, 30)}“`]);
      }
      for (let i = 0; i < numbers.length; i++)
        for (let j = i + 1; j < numbers.length; j++)
          if (onScreen(numbers[i].b) && hit(numbers[i].b, numbers[j].b, 2)) out.push(["nummern", `${numbers[i].el.textContent.trim()} auf ${numbers[j].el.textContent.trim()}`]);
      const cards = [...document.querySelectorAll(".mark-label[data-selected] .mark-label__note, .mark-label:hover .mark-label__note")].filter(shown);
      for (const c of cards) {
        const b = box(c);
        const n = c.closest(".mark-label").querySelector(".mark-label__number")?.textContent.trim();
        if (b.x < 0 || b.x + b.w > vw + 0.5 || b.y < barH - 0.5 || b.y + b.h > vh) out.push(["karte", `Karte ${n} ragt hinaus (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`]);
        if (tb && hit(b, tb)) out.push(["karte", `Karte ${n} auf der Werkzeugleiste`]);
        const own = c.closest(".mark-label").dataset.item;
        if (c.closest(".mark-label[data-selected]")) for (const p of pills) if (p.el.dataset.item === own && hit(b, p.b, 1)) out.push(["karte-marke", `Karte ${n} auf „${p.el.textContent.trim().slice(0, 30)}“`]);
      }
      for (const ed of [...document.querySelectorAll(".note-editor")].filter(shown)) {
        const b = box(ed);
        if (b.x < 0 || b.x + b.w > vw + 0.5 || b.y < barH - 0.5 || b.y + b.h > vh) out.push(["editor", `Notizfeld ragt hinaus (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`]);
        if (tb && hit(b, tb)) out.push(["editor", "Notizfeld auf der Werkzeugleiste"]);
      }
      style.remove();
      return out;
    });

  const settle = async () => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(60);
  };
  const record = async (scene) => {
    frames++;
    if (SHOTS && process.env.CANVAS_SAVE_ALL) await page.screenshot({ path: path.join(SHOTS, `all-${String(frames).padStart(4, "0")}.png`) });
    const found = await measure();
    for (const [kind, text] of found) {
      const key = `${kind}: ${text}`;
      if (!problems.has(key)) {
        problems.set(key, scene);
        if (SHOTS && problems.size <= 40) await page.screenshot({ path: path.join(SHOTS, `${String(problems.size).padStart(2, "0")}-${kind}.png`) });
      }
    }
  };

  for (const [winW, winH] of SIZES) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [winW, winH]);
  await sleep(600);
  const facts = await page.evaluate(() => window.__surface.facts());
  const vp = facts.viewport;
  const bar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-height")) || 0);
  const WIDTHS = [140, 300, 520, 900, 1600, 3200];
  for (const [i, node] of nodes.entries()) {
    for (const sw of WIDTHS) {
      const z = sw / node.width;
      // Lagen: Bildkopf sichtbar unter der Kopfzeile, Bildkopf oben abgeschnitten, Bild links abgeschnitten.
      const lagen = {
        ganz: { x: node.x - (vp.w - sw) / 2 / z, y: node.y - (bar + 60) / z },
        oben: { x: node.x - (vp.w - sw) / 2 / z, y: node.y + 150 / z },
        links: { x: node.x + Math.min(sw * 0.4, 300) / z, y: node.y - (bar + 60) / z },
      };
      for (const [lage, c] of Object.entries(lagen)) {
        const scene = `${winW}×${winH} · ${node.canvas.title} · ${sw} px · ${lage}`;
        if (ONLY && !ONLY.test(scene)) continue;
        await page.keyboard.press("Escape");
        await page.evaluate((cam) => window.__surface.jumpTo(cam), { x: c.x, y: c.y, z });
        await settle();
        await record(`${scene} · ohne Auswahl`);
        if (process.env.CANVAS_DEBUG) { await page.evaluate(() => window.__surface.place()); await sleep(100); }
        if (process.env.CANVAS_DEBUG)
          console.log(scene, JSON.stringify(await page.evaluate(() => ({
            pills: [...document.querySelectorAll(".surface-title__pill")].map((e) => [e.textContent, JSON.parse(JSON.stringify(e.getBoundingClientRect()))]).slice(0, 2),
            nums: [...document.querySelectorAll(".mark-label__number")].slice(0, 3).map((e) => [e.textContent, JSON.parse(JSON.stringify(e.getBoundingClientRect()))]),
            root: JSON.parse(JSON.stringify(document.querySelector(".surface")?.getBoundingClientRect())),
            chain: (() => { const out = []; let e = document.querySelector(".surface-title"); while (e) { const r = e.getBoundingClientRect(); out.push([e.className, Math.round(r.left), Math.round(r.width), getComputedStyle(e).transform.slice(0, 40)]); e = e.parentElement; } return out; })(),
            obstacles: [...document.querySelectorAll("[data-obstacle]")].map((e) => Math.round(e.getBoundingClientRect().left) + "+" + Math.round(e.getBoundingClientRect().width)),
          }))));
        const labels = await page.evaluate((item) => {
          const ids = [];
          document.querySelectorAll(".mark-label").forEach((el, k) => {
            const r = el.getBoundingClientRect();
            if (el.getClientRects().length && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) ids.push(k);
          });
          return ids;
        }, node.id);
        for (const k of labels) {
          const num = page.locator(".mark-label").nth(k).locator(".mark-label__number");
          if (await num.isVisible().catch(() => false)) {
            await num.hover({ force: true, timeout: 2000 }).catch(() => {});
            await settle();
            await record(`${scene} · zeigt auf ${k + 1}`);
          }
          await page.evaluate((k) => document.querySelectorAll(".mark-label")[k]?.click(), k);
          await page.mouse.move(2, vp.h - 2);
          await settle();
          await record(`${scene} · gewählt ${k + 1}`);
          // Bearbeiten: das Notizfeld liegt ganz im Fenster, nicht auf der Werkzeugleiste.
          if (k === labels[0] || k === labels[labels.length - 1]) {
            await page.evaluate((k) => document.querySelectorAll(".mark-label")[k]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), k);
            await settle();
            await record(`${scene} · bearbeitet ${k + 1}`);
            await page.keyboard.press("Escape");
          }
          await page.keyboard.press("Escape");
        }
      }
    }
  }
  }
} finally {
  await app.close();
}

const byKind = {};
for (const [key, scene] of problems) (byKind[key.split(":")[0]] ??= []).push(`${key}   [${scene}]`);
console.log(`${frames} Ansichten geprüft, ${problems.size} verschiedene Probleme`);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n${kind} (${list.length})`);
  for (const l of list.slice(0, 25)) console.log("  " + l);
}
process.exit(problems.size ? 1 : 0);
