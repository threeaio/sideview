// Abdunkelung der gewählten Notiz in der echten App (verborgenes Fenster, eigener Datenordner): deckt sie in jedem
// Bild einer Fahrt das ganze Sichtfenster ab? Anlass 23.11.: Beim schnellen Durchgehen der Notizen war die Kante
// der Abdunkelung zu sehen, sie verschob sich oder fehlte. Der Schatten reichte fest 100vmax; liegt der gewählte Rahmen
// während der Fahrt weiter draußen, endete er mitten im Bild oder fehlte ganz.
// Aufruf: npm run check:scrim   Bilder je Sprung: node scripts/check-scrim.mjs <ordner>
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-scrim-"));
fs.mkdirSync(path.join(data, "canvases"));
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "de", decision: { baseUrl: "", model: "" } }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixture = path.join(ROOT, "test/fixtures/page");
const pages = [0, 1, 2].map((i) => ({ id: `img${i}`, file: path.join(fixture, "desktop.png"), x: i * 1640, w: 1440, h: 6000 }));
const rects = [[100, 100, 600, 300], [100, 5500, 600, 300], [800, 2800, 400, 300]];
const nodes = pages.map((p, i) => ({
  id: p.id, type: "file", file: p.file, x: p.x, y: 0, width: p.w, height: p.h,
  canvas: {
    title: `Seite ${i + 1}`, origin: { kind: "file", ref: p.file, fetchedAt: "2026-11-23T00:00:00.000Z" }, imageWidth: p.w, imageHeight: p.h, scale: 1,
    annotations: rects.map((rect, k) => ({ id: `a${i}-${k}`, itemId: p.id, rect, note: `Notiz ${i}-${k}`, createdAt: "2026-11-23T00:00:00.000Z", source: "text" })),
  },
}));
const group = { id: "grp", type: "group", label: "Seiten", x: -160, y: -160, width: 3 * 1640 + 120, height: 6320, canvas: { items: nodes.map((n) => n.id) } };
fs.writeFileSync(path.join(data, "canvases/scrim.canvas"), JSON.stringify({ nodes: [group, ...nodes], edges: [], canvas: { title: "Scrim", updatedAt: "2026-11-23T00:00:00.000Z" } }));

const app = await electron.launch({ args: [path.join(ROOT, "src/electron/main.ts")], cwd: ROOT, env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: "4795", CANVAS_QUIET: "1", CANVAS_VOICE: "0" } });
let bad = 0;
let total = 0;
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
  await page.waitForFunction(() => window.__surface?.facts().images > 0, null, { timeout: 30_000 });
  await sleep(1500);
  const shot = async (name) => {
    if (!OUT) return;
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, "base64"));
  };
  // Je Bild der Animation: Lage des gewählten Rahmens und ob sein Schatten das Fenster abdeckt.
  await page.evaluate(() => {
    window.__scrim = [];
    const tick = () => {
      const m = document.querySelector(".mark[data-selected]");
      const s = document.querySelector(".surface").getBoundingClientRect();
      if (m) {
        const r = m.getBoundingClientRect();
        const cs = getComputedStyle(m);
        const spread = Math.max(0, ...[...cs.boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map((m) => Number(m[4]))); // tatsächlicher Spread
        const covered = r.left - spread <= s.left && r.right + spread >= s.right && r.top - spread <= s.top && r.bottom + spread >= s.bottom;
        window.__scrim.push({ t: performance.now(), x: Math.round(r.left), y: Math.round(r.top), covered, shown: cs.display !== "none" && cs.visibility !== "hidden" && r.width + r.height > 0 });
      } else window.__scrim.push({ t: performance.now(), none: true });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Schnell durch die Notizen: Liste öffnen, Anmerkung wählen, kurz warten, nächste.
  const order = [1, 5, 9, 2, 8, 4, 7, 3, 6];
  for (const [i, n] of order.entries()) {
    await page.click('[data-option="anmerkungen"]');
    await sleep(120);
    await page.click(`[data-option="anmerkung-${n}"]`);
    await page.click('[data-option="anmerkungen"]').catch(() => {});
    await sleep(i % 2 ? 250 : 120);
    await shot(`fahrt-${String(i).padStart(2, "0")}-n${n}.png`);
  }
  await sleep(1500);
  const frames = await page.evaluate(() => window.__scrim);
  total = frames.filter((f) => !f.none).length;
  const gaps = frames.filter((f) => !f.none && (!f.covered || !f.shown));
  bad = gaps.length;
  console.log(`${bad ? "✗" : "✓"} ${total} Bilder mit gewählter Notiz, davon ${bad} ohne volle Abdunkelung`);
  for (const g of gaps.slice(0, 12)) console.log(" ", JSON.stringify(g));
} finally {
  await app.close();
}
process.exitCode = bad ? 1 : 0;
