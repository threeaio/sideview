// Prüft die englische Fassung in der echten App, ohne sichtbares Fenster und mit eigener Datenablage:
// Einstellung `language: "en"`, Texte der Startansicht, des Menüs, der Werkzeugleiste, der Besprechung und der
// Einstellungen auf Englisch; dann der englische Sprachweg mit der macOS-Stimme „Samantha“ (whisper, Code, ohne Jev):
// „Overview“, „Next“, eine diktierte Notiz mit „save“ am Ende und „Done“, das die Besprechung beendet.
// Aufruf: npm run check:english   (baut vorher den Renderer). Ports 4726 und 4737; stört eine laufende App nicht.

import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Three images from the repository's own fixtures (test/fixtures/page): desktop, mobile and a crop of the desktop.
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "../test/fixtures/page");
const IMG = [path.join(FIXTURES, "desktop.png"), path.join(FIXTURES, "mobile.png")];
const PORT = 4726;
const NAME = "english";
// Samantha (en_US) ist auf macOS meist installiert; sonst die erste andere en_US-Stimme mit Menschennamen.
const VOICE = (() => {
  const voices = execFileSync("say", ["-v", "?"], { encoding: "utf8" }).split("\n").map((l) => l.match(/^(.+?)\s+(\w\w_\w\w)\s+#/)).filter(Boolean);
  const us = voices.filter((m) => m[2] === "en_US").map((m) => m[1].trim());
  return us.includes("Samantha") ? "Samantha" : (us.find((v) => /^(Alex|Allison|Ava|Susan|Tom|Fred)$/.test(v)) ?? us[0] ?? "Samantha");
})();

const data = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-english-"));
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ keywords: [], language: "en" }));
const out = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (out) fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, facts = {}) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`, JSON.stringify(facts));
};

const app = await electron.launch({
  args: [path.join(ROOT, "src/electron/main.ts")],
  cwd: ROOT,
  env: { ...process.env, CANVAS_DATA: data, CANVAS_PORT: String(PORT), CANVAS_QUIET: "1", CANVAS_WHISPER_PORT: "4737", TYPESAFE_API_KEY: "" },
});

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.waitForSelector(".review-bar", { timeout: 20_000 });
  const api = async (method, url, body) => {
    const token = fs.readFileSync(path.join(data, "run/api-token"), "utf8").trim();
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  };
  const facts = () => page.evaluate(() => window.__surface?.facts() ?? null);
  const settle = async (n) => {
    const t0 = Date.now();
    for (;;) {
      const f = await facts();
      if (f && !f.flying && f.settled && f.images === n) return f;
      if (Date.now() - t0 > 20_000) throw new Error(`not settled: ${JSON.stringify(f)}`);
      await sleep(40);
    }
  };
  const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.innerText?.replace(/\s+/g, " ").trim() ?? null, sel);
  const waitText = async (sel, want, ms = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const got = await text(sel);
      if (got !== null && (want instanceof RegExp ? want.test(got) : got === want)) return got;
      if (Date.now() - t0 > ms) return got;
      await sleep(50);
    }
  };
  const shot = async (name) => {
    if (!out) return;
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(b64, "base64"));
  };
  /** Satz der englischen macOS-Stimme über whisper, wie vom Mikrofon. */
  const say = async (sentence) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-english-say-"));
    const file = path.join(dir, "sentence.m4a");
    execFileSync("say", ["-v", VOICE, "-o", file, "--file-format=m4af", sentence]);
    const result = await page.evaluate((b64) => window.__voice.inject(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), "audio/mp4"), fs.readFileSync(file).toString("base64"));
    fs.rmSync(dir, { recursive: true, force: true });
    await sleep(80);
    return { said: sentence, heard: result?.transcript, decision: result?.decision };
  };

  // 1. Ohne Canvas: Startansicht, Sprache am Dokument, Menü.
  const homeTitle = await waitText(".home__title", "No canvas yet");
  check("Start view in English", homeTitle === "No canvas yet" && (await text(".home-tile--new .home-tile__title")) === "New canvas", { homeTitle });
  check("Document language is en", (await page.evaluate(() => document.documentElement.lang)) === "en");
  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    return { top: m.items.map((i) => i.label), settings: m.getMenuItemById("settings")?.label, newCanvas: m.getMenuItemById("new-canvas")?.label, undo: m.getMenuItemById("undo")?.label };
  });
  check("Menu in English", menu.top.includes("File") && menu.top.includes("Edit") && menu.top.includes("View") && menu.settings === "Settings …" && menu.undo === "Undo", menu);

  // 2. Canvas mit drei Bildern: Kopfzeile und Werkzeugleiste.
  // A third image: the top of the desktop page, cut with sharp into the data folder.
  const third = path.join(data, "header.png");
  const sharp = (await import("sharp")).default;
  await sharp(IMG[0]).extract({ left: 0, top: 0, width: 1440, height: 900 }).toFile(third);
  await api("POST", `/api/canvases/${NAME}/open`, { title: "English", images: [...IMG, third].map((p) => ({ path: p })) });
  await settle(3);
  const crumbs = await text(".crumbs");
  check("Path “Canvases / English”", crumbs?.startsWith("Canvases / English"), { crumbs });
  const toolbar = await text(".toolbar");
  check("Toolbar in English", /Select/.test(toolbar) && /Mark/.test(toolbar) && !/Auswählen|Markieren/.test(toolbar), { toolbar });
  check("Notes counter in English", (await text(".notes__label")) === "0 notes", { notes: await text(".notes__label") });

  // 3. Claude wartet.
  const { reviewId } = await api("POST", `/api/canvases/${NAME}/reviews`, { prompt: "Does the header work?" });
  await page.waitForSelector('.claude-card [data-option="fertig"]:not([disabled])', { timeout: 5000 });
  const card = await text(".claude-card");
  check("Review bar: “Your agent is waiting” and “Done”", /Your agent is waiting/.test(card) && (await text('.claude-card [data-option="fertig"]')) === "Done", { card });
  await shot("1-waiting");

  // 4. Sprache: whisper muss bereit sein.
  const appLog = () => fs.readFileSync(path.join(data, "logs/app.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const t1 = Date.now(); !appLog().some((e) => e.event === "whisper_ready"); await sleep(200)) {
    if (appLog().some((e) => e.event === "whisper_error") || Date.now() - t1 > 60_000) throw new Error("whisper does not start");
  }
  const v1 = await say("Overview");
  await settle(3);
  const all = await waitText(".stepper__count", "3 images");
  check("Voice “Overview”", v1.decision?.kind === "command" && v1.decision.id === "uebersicht" && all === "3 images", { ...v1, count: all });
  check("Voice result shown in English", (await text(".voice__did")) === "Overview", { did: await text(".voice__did") });
  const v2 = await say("Next");
  await settle(3);
  const first = await waitText(".stepper__count", "1 / 3");
  check("Voice “Next”", v2.decision?.id === "naechstes-bild" && first === "1 / 3", { ...v2, count: first });

  // 5. Rahmen ziehen (Claude wartet: Werkzeug Markieren), Notiz diktieren, „save“ am Ende sichert.
  const surface = await page.$eval(".surface", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const p0 = { x: surface.x + surface.w * 0.42, y: surface.y + surface.h * 0.3 };
  const p1 = { x: surface.x + surface.w * 0.58, y: surface.y + surface.h * 0.5 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 8, p0.y + ((p1.y - p0.y) * i) / 8);
  await page.mouse.up();
  await page.waitForSelector(".note-editor__text", { timeout: 5000 });
  const editor = await page.evaluate(() => ({
    placeholder: document.querySelector(".note-editor__text")?.placeholder,
    buttons: [...document.querySelectorAll(".note-editor__actions button")].map((b) => b.textContent),
  }));
  check("Note field in English", editor.placeholder === "Note" && editor.buttons.join(",") === "Discard,Save", editor);
  await shot("2-note-field");
  const v3 = await say("The logo is too small, save.");
  await sleep(300);
  const editorOpen = Boolean(await page.$(".note-editor__text"));
  const note = (await api("GET", `/api/canvases/${NAME}`)).annotations?.at(-1)?.note ?? null;
  check("Voice: dictated note with “save” at the end is saved", v3.decision?.kind === "dictation" && v3.decision.save === true && !editorOpen && /logo is too small/i.test(note ?? "") && !/save/i.test(note ?? ""), { ...v3, note, editorOpen });

  // 6. „Done“ beendet die Besprechung.
  const v4 = await say("Done");
  const status = await api("GET", `/api/reviews/${reviewId}?wait=5000`);
  const sent = await waitText(".claude-card[data-sent]", "Sent to your agent", 3000);
  check("Voice “Done” finishes the review", v4.decision?.id === "fertig" && status.status !== "waiting" && status.result?.annotations?.length === 1 && sent === "Sent to your agent", { ...v4, status: status.status, sent });
  check("Notes counter after the note", (await text(".notes__label")) === "1 note", { notes: await text(".notes__label") });
  await shot("3-sent");

  // 7. Einstellungen über das Menü.
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("settings").click());
  await page.waitForSelector("dialog.settings[open]", { timeout: 3000 });
  const settings = await page.evaluate(() => ({
    title: document.querySelector(".settings__title")?.textContent,
    headings: [...document.querySelectorAll(".settings__heading")].map((h) => h.textContent),
    language: [...document.querySelectorAll(".segmented__item")].map((b) => `${b.textContent}${b.getAttribute("aria-checked") === "true" ? "*" : ""}`),
  }));
  check(
    "Settings in English",
    settings.title === "Settings" && ["Keywords", "Language", "Understanding commands"].every((h) => settings.headings.includes(h)) && settings.language.includes("English*"),
    settings,
  );
  await shot("4-settings");
  await page.keyboard.press("Escape");

  const log = appLog();
  const errors = log.filter((e) => e.event === "renderer_console" && e.level === "error");
  check("No errors in the interface", errors.length === 0, { errors: errors.slice(0, 3) });
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await app.close().catch(() => {});
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED (voice ${VOICE})` : `all ok (voice ${VOICE})`);
  process.exitCode = failed ? 1 : 0;
}
