// Screenshots for the README, taken from the real app (hidden window, own data folder, English UI):
//   docs/images/review.png    three pages side by side, Claude is waiting, a frame with a note on one header
//   docs/images/resolved.png  the note checked off with Claude's reply
//   docs/images/versions.png  a page replaced by its next version, the old one stacked behind
// Usage: npm run build:renderer && node scripts/shots-readme.mjs [output folder]
//   README_PAGES=<a>,<b>,<c>[,<older c>]  page-shots folders (desktop.png + regions.json) to show; the fourth is an
//   earlier version of the third, shown in versions.png. Without it, the test fixture stands in for all of them.
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs/public/images"));
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-readme-"));
const PORT = "4791";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "en", decision: { baseUrl: "", model: "" } }));

/** Copies a page-shots folder and points its regions.json at the copy, as the skill leaves it. */
function stage(from, name) {
  const dir = path.join(data, "shots", name);
  fs.mkdirSync(dir, { recursive: true });
  const regions = JSON.parse(fs.readFileSync(path.join(from, "regions.json"), "utf8"));
  const view = regions.views.desktop;
  fs.copyFileSync(path.join(from, path.basename(view.image)), path.join(dir, "desktop.png"));
  regions.views = { desktop: { ...view, image: path.join(dir, "desktop.png") } };
  fs.writeFileSync(path.join(dir, "regions.json"), JSON.stringify(regions, null, 2));
  return path.join(dir, "desktop.png");
}

const given = (process.env.README_PAGES || "").split(",").filter(Boolean);
const sources = given.length >= 3 ? given : Array(4).fill(path.join(ROOT, "test/fixtures/page"));
const [a, b, c] = ["page-a", "page-b", "page-c"].map((n, i) => stage(sources[i], n));
const older = sources[3] ? stage(sources[3], "page-c-older") : null;
const names = given.length >= 3 ? ["Gantry Tapes", "Afterglass", "Threshold"] : ["Page A", "Page B", "Page C"];

const app = await electron.launch({
  args: [path.join(ROOT, "src/electron/main.ts")],
  cwd: ROOT,
  env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: PORT, CANVAS_QUIET: "1", CANVAS_VOICE: "0" },
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.waitForSelector(".review-bar", { timeout: 30_000 });
  const api = async (method, url, body) => {
    const token = fs.readFileSync(path.join(data, "run/api-token"), "utf8").trim();
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  };
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    const file = path.join(OUT, name);
    await sharp(Buffer.from(b64, "base64")).resize({ width: 1440 }).png({ compressionLevel: 9, palette: true }).toFile(file);
    console.log(file);
  };
  const look = async (cam) => {
    await page.evaluate((cam) => window.__surface.jumpTo(cam), cam);
    await sleep(1800);
  };
  const screen = async (item, ix, iy) => page.evaluate(({ item, ix, iy }) => {
    const { camera: c } = window.__surface.facts();
    return { x: (item.x + ix * item.w / item.imageWidth - c.x) * c.z, y: (item.y + iy * item.h / item.imageHeight - c.y) * c.z };
  }, { item, ix, iy });
  const surface = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector(".surface").getBoundingClientRect())));

  // 1. Three pages in a group; Claude waits for the review. The user frames the second header and types a note.
  const opened = await api("POST", "/api/canvases/landing-pages/open", {
    title: "Landing pages",
    group: "Landing pages",
    images: [a, b, c].map((p, i) => ({ path: p, title: names[i] })),
  });
  await api("POST", "/api/canvases/landing-pages/reviews", { prompt: "Which header works best?" });
  await sleep(1500);
  const rectOf = (it) => ({ x: it.x, y: it.y, w: it.imageWidth / it.scale, h: it.imageHeight / it.scale, imageWidth: it.imageWidth, imageHeight: it.imageHeight });
  const items = opened.canvas.items;
  const [ra, rb, rc] = items.map(rectOf);
  // Camera: the middle page wide enough for frames and numbers (from 480 px on screen), its neighbours cut at the sides.
  const z = 600 / rb.w;
  await look({ x: rb.x + rb.w / 2 - surface.width / 2 / z, y: rb.y - 120 / z, z });
  const from = await screen(rb, 30, 540);
  const to = await screen(rb, 820, 1180);
  await page.mouse.move(surface.x + from.x, surface.y + from.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(surface.x + from.x + ((to.x - from.x) * i) / 12, surface.y + from.y + ((to.y - from.y) * i) / 12);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".note-editor__text");
  await page.keyboard.type("The name gets lost in the box. Larger, and give it more room above.");
  await page.keyboard.press("Enter");
  await sleep(600);
  await page.hover(".mark-label__number");
  await sleep(400);
  await shot("review.png");

  // 2. Claude fixed it and checks the note off with a one-line reply.
  await page.mouse.move(surface.x + 20, surface.y + surface.height - 20);
  await page.click('.claude-card [data-option="fertig"]');
  await sleep(6000);
  await api("POST", "/api/canvases/landing-pages/resolve-annotations", { annotations: [{ ref: "1", reply: "Set the name 40 % larger with twice the space above." }] });
  await sleep(600);
  await page.evaluate(() => document.querySelector(".mark-label")?.click());
  await sleep(700);
  await shot("resolved.png");
  await page.keyboard.press("Escape");

  // 3. A new version replaces the third page in place; the earlier one stays stacked behind it.
  const third = items[2];
  if (older) {
    // The earlier version goes up first, then the current one replaces it.
    await api("POST", "/api/canvases/landing-pages/open", { images: [{ path: older, title: names[2], replaces: third.id }] });
    await sleep(800);
    await api("POST", "/api/canvases/landing-pages/open", { images: [{ path: c, title: names[2], replaces: third.id }] });
  } else {
    const revised = path.join(data, "shots/page-c/desktop-v2.png");
    await sharp(c).modulate({ brightness: 1.02, saturation: 1.25 }).toFile(revised);
    await api("POST", "/api/canvases/landing-pages/open", { images: [{ path: revised, title: names[2], replaces: third.id }] });
  }
  await sleep(1000);
  const now = await api("GET", "/api/canvases/landing-pages");
  const it = now.items.find((p) => p.id === third.id);
  const w = it.imageWidth / it.scale;
  const zz = (surface.height - 160) / 1400;
  await look({ x: it.x + w / 2 - surface.width / 2 / zz, y: it.y - 140 / zz, z: zz });
  await shot("versions.png");
} finally {
  await app.close();
}
