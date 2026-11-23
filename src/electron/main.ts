// Electron-Hülle: startet die lokale Schnittstelle im selben Prozess, zeigt die Fläche im Fenster
// und verbindet Oberfläche und Hauptprozess. Läuft weiter, wenn das Fenster zu ist, damit Claude
// die Fläche jederzeit wieder öffnen kann. Beenden mit Cmd+Q.
// Achtung: kein `await app.whenReady()` auf oberster Ebene, das hängt in Electron 45.

import { app, BrowserWindow, clipboard, ipcMain, Menu, net, protocol, session, systemPreferences } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { PRODUCT } from "../shared/brand.ts";
import { ROOT, config, paths } from "../shared/config.ts";
import { DROP_CANVAS, EVENTS, INVOKE, TILE_SCHEME, type AnnotationPatch, type NewAnnotationInput, type OpenedEvent, type ThumbnailRequest, type VoiceStatus } from "../shared/ipc.ts";
import { slugify } from "../shared/names.ts";
import { EXTENSION_CHANNEL, type MainExtension, type MainExtensionContext, type McpExtension, type PlaceImage } from "../shared/extensions.ts";
import { registerOrigin } from "../shared/origins.ts";
import { loadExtensions } from "../main/extensions.ts";
import { cropAnnotation, cropRect, previewImage } from "../mcp/crops.ts";
import type { Annotation, CanvasState, Layout, Rect, RemovedItems } from "../shared/contracts.ts";
import { reviewResult } from "../main/api.ts";
import { startApp } from "../main/serve.ts";
import { ensureTiles, tileFile } from "../main/tiles.ts";
import { createSettingsStore } from "../main/settings-store.ts";
import { createVoice, type Voice } from "../main/voice/voice.ts";
import { resolveLanguage, saveWords, type Language, type Settings } from "../shared/settings.ts";
import { t, type TextKey } from "../shared/i18n/index.ts";
import { checkSpeech } from "../main/voice/setup.ts";
import { deleteKeychainKey, readKeychainKey, writeKeychainKey } from "../main/secrets.ts";
import type { VoiceRequest } from "../shared/voice.ts";

/** Rohformate der Zwischenablage unter macOS: im Finder kopierte Datei, kopiertes Bild als TIFF (etwa aus Vorschau). */
const FILE_URL = 'electron application/osclipboard;format="public.file-url"';
const TIFF = ['electron application/osclipboard;format="public.tiff"', 'electron application/osclipboard;format="NeXT TIFF v4.0 pasteboard type"'];
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i;

protocol.registerSchemesAsPrivileged([
  { scheme: TILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Eigene Datenablage = eigene App-Instanz. So stören weder Prüfungen mit Testdaten noch die Entwicklung aus dem Repo
// die installierte App.
app.setPath("userData", path.join(config.dataDir, "electron"));
// Zweiter Start: sofort beenden, ohne irgendetwas anzufangen. Mit app.quit() lief whenReady trotzdem weiter und
// schrieb einen neuen Schlüssel nach run/api-token, den die laufende App nicht kannte (23.11.).
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);

let win: BrowserWindow | null = null;
let lastOpened: OpenedEvent | null = null;
/** Welches Canvas zuletzt gezeigt wurde, über Neustarts hinweg (data/run/last-canvas). */
const lastCanvasFile = () => path.join(config.dataDir, "run", "last-canvas");
function remember(event: OpenedEvent) {
  lastOpened = event;
  void fs.mkdir(path.dirname(lastCanvasFile()), { recursive: true }).then(() => fs.writeFile(lastCanvasFile(), event.state.name));
}
let log: (event: string, data: Record<string, unknown>) => void = () => {};
// Zum Prüfen ohne Bildschirm (scripts/check-surface.mjs): CANVAS_QUIET=1 zeigt kein Fenster.
// So stört eine Prüfung niemanden, der gerade am Rechner arbeitet.
const quiet = process.env.CANVAS_QUIET === "1";

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1400,
    height: 920,
    title: PRODUCT,
    backgroundColor: "#f5f5f7",
    show: false,
    webPreferences: {
      preload: path.join(ROOT, "src/electron/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Ein verstecktes Fenster malt sonst nicht neu, und der Schnappschuss zeigt einen alten Stand.
      backgroundThrottling: !quiet,
    },
  });
  // Die Titelleiste trägt immer den App-Namen (package.json), nicht den Seitentitel der Oberfläche.
  w.on("page-title-updated", (e) => e.preventDefault());
  const devUrl = process.env.CANVAS_RENDERER_URL;
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(path.join(ROOT, "dist/renderer/index.html"));
  // Meldungen der Oberfläche ab Warnung ins Protokoll, damit Fehler im Fenster nicht unbemerkt bleiben.
  w.webContents.on("console-message", (e) => {
    if (e.level === "warning" || e.level === "error") log("renderer_console", { level: e.level, message: e.message.slice(0, 500), source: e.sourceId, line: e.lineNumber });
  });
  w.webContents.on("preload-error", (_e, preloadPath, error) => log("preload_error", { preloadPath, error: String(error) }));
  // Eine Datei, die neben der Fläche landet, darf das Fenster nicht auf die Datei umleiten.
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.once("ready-to-show", () => {
    if (!quiet) w.show();
  });
  // Schließen versteckt nur; die App bleibt für Claude erreichbar.
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  return w;
}

let quitting = false;

// Eine aus Claude oder dem Finder gestartete App hat einen kurzen PATH; whisper-server und ffmpeg liegen in Homebrew.
process.env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(":");

/** Schlüssel für das Entscheidungsmodell: Umgebung vor Keychain. Bei jeder Äußerung neu, damit ein neu
 * eingetragener Schlüssel sofort gilt. */
let keychainKey: string | null | undefined;
function decisionKey(): { key: string | null; from: "env" | "keychain" | null } {
  if (process.env.TYPESAFE_API_KEY) return { key: process.env.TYPESAFE_API_KEY, from: "env" };
  if (keychainKey === undefined) keychainKey = process.env.TYPESAFE_API_KEY === "" ? null : readKeychainKey();
  return { key: keychainKey, from: keychainKey ? "keychain" : null };
}

/** Mikrofon nur für die eigene Oberfläche. macOS fragt beim ersten Mal selbst nach. */
function allowMicrophone() {
  const own = (url: string) => url.startsWith("file://") || (process.env.CANVAS_RENDERER_URL ? url.startsWith(process.env.CANVAS_RENDERER_URL) : false);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(permission === "media" && own(wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === "media" && own(wc?.getURL() ?? ""));
  if (process.platform !== "darwin" || quiet) return;
  const status = systemPreferences.getMediaAccessStatus("microphone");
  log("microphone_status", { status });
  // Nicht warten: Das ist ein Systemdialog, die Fläche soll trotzdem sofort da sein.
  if (status === "not-determined") void systemPreferences.askForMediaAccess("microphone").then((ok) => log("microphone_answer", { ok }));
}

function bringToFront() {
  if (!win) win = createWindow();
  if (quiet) return;
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
}

/** Hängt jedem Bild seine Kacheln an; erzeugt sie beim ersten Mal (rund eine Sekunde je Screenshot). */
async function withTiles(state: CanvasState): Promise<CanvasState> {
  const items = await Promise.all(
    state.items.map(async (item) => {
      try {
        return { ...item, tiles: await ensureTiles(item.path) };
      } catch (e) {
        log("tiles_error", { canvas: state.name, item: item.id, detail: String(e) });
        return item;
      }
    }),
  );
  return { ...state, items };
}

app.on("second-instance", bringToFront);
app.on("activate", bringToFront);

/** Stand des Häkchens „Dunkler Grund“: bleibt, wenn das Menü in einer anderen Sprache neu entsteht. */
let darkStage = false;

/**
 * Menü der App in der Sprache der Oberfläche; neu gebaut, wenn sich die Sprache ändert.
 * Ohne die Zoom-Befehle des Standardmenüs: Cmd+Plus und Cmd+Minus zoomen die Fläche, nicht die ganze Oberfläche.
 */
function setMenu(lang: Language) {
  const m = (key: TextKey) => t(lang, key);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: PRODUCT,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { id: "settings", label: m("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => {
            bringToFront();
            win?.webContents.send(EVENTS.openSettings);
          } },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: m("menu.file"),
        submenu: [
          { id: "new-canvas", label: m("menu.newCanvas"), accelerator: "CmdOrCtrl+N", click: () => {
            bringToFront();
            win?.webContents.send(EVENTS.newCanvas);
          } },
          { id: "open-canvas", label: m("menu.openCanvas"), accelerator: "CmdOrCtrl+O", click: () => {
            bringToFront();
            win?.webContents.send(EVENTS.openCanvases);
          } },
        ],
      },
      {
        // Eigenes Bearbeiten-Menü: Widerrufen und Wiederholen gehen an die Oberfläche. Sie entscheidet, ob ein
        // Textfeld gemeint ist oder das Canvas. Mit der Standardrolle kam Cmd+Z nie beim Canvas an (5.11.).
        label: m("menu.edit"),
        submenu: [
          { id: "undo", label: m("menu.undo"), accelerator: "CmdOrCtrl+Z", click: () => win?.webContents.send(EVENTS.undo) },
          { id: "redo", label: m("menu.redo"), accelerator: "Shift+CmdOrCtrl+Z", click: () => win?.webContents.send(EVENTS.redo) },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          // Wie Widerrufen: Die Oberfläche entscheidet. Mit der Standardrolle kam beim Canvas kein Einsetzen an (6.11.).
          { id: "paste", label: m("menu.paste"), accelerator: "CmdOrCtrl+V", click: () => win?.webContents.send(EVENTS.paste) },
          { role: "selectAll" },
        ],
      },
      {
        label: m("menu.view"),
        submenu: [
          // Grund unter den Screenshots: hell oder dunkel. Die Oberfläche merkt sich die Wahl.
          { label: m("menu.darkStage"), type: "checkbox", checked: darkStage, click: (item) => {
            darkStage = item.checked;
            win?.webContents.send(EVENTS.stage, item.checked ? "dark" : "light");
          } },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

app.whenReady().then(async () => {
  if (!primary) return;
  setMenu(resolveLanguage("auto", app.getPreferredSystemLanguages()));
  const core = await startApp({
    onOpen: (state, focus) => {
      void withTiles(state).then((shown) => {
        remember({ state: shown, focus });
        bringToFront();
        win?.webContents.send(EVENTS.opened, lastOpened);
      });
    },
    onChange: (state) => void withTiles(state).then((shown) => win?.webContents.send(EVENTS.changed, shown)),
    onReviewsChange: () => win?.webContents.send(EVENTS.reviews, core.reviews.open()),
  });
  log = core.log;
  const settings = await createSettingsStore();
  log("decision_key", { from: decisionKey().from });
  allowMicrophone();
  const language = () => resolveLanguage(settings.get().language, app.getPreferredSystemLanguages());
  setMenu(language());
  // Sprache nur, wenn whisper-server, ein Modell und ffmpeg da sind; sonst läuft alles andere ohne sie.
  // CANVAS_VOICE=0 schaltet sie ab, etwa für Prüfungen ohne Mikrofon.
  const speech = checkSpeech();
  log("speech_setup", { missing: speech.missing, model: speech.model && path.basename(speech.model) });
  const voice: Voice | null =
    process.env.CANVAS_VOICE === "0" || speech.missing.length
      ? null
      : createVoice({
          appLog: log,
          whisperBin: speech.whisper!,
          model: speech.model!,
          saveWords: () => saveWords(settings.get()),
          language,
          decision: () => ({ apiKey: decisionKey().key, ...settings.get().decision }),
        });

  // Kacheln nur aus data/tiles: canvas-tile://<schlüssel>/<stufe>/<spalte>_<zeile>.png
  protocol.handle(TILE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = tileFile(url.hostname, url.pathname.slice(1));
    if (!file) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const changed = async (canvas: string) => {
    const state = await core.store.get(canvas);
    if (state) win?.webContents.send(EVENTS.changed, await withTiles(state));
  };

  ipcMain.handle(INVOKE.list, () => core.store.list());
  ipcMain.handle(INVOKE.get, async (_e, name: string) => {
    const state = await core.store.get(name);
    return state && withTiles(state);
  });
  // Nach einem Start (auch nach einem Update) das zuletzt gezeigte Canvas wieder zeigen, sonst das zuletzt geänderte.
  ipcMain.handle(INVOKE.current, async () => {
    if (lastOpened) return lastOpened;
    // CANVAS_START_EMPTY=1: mit der Startansicht beginnen (Prüfungen).
    if (process.env.CANVAS_START_EMPTY === "1") return null;
    const remembered = await fs.readFile(lastCanvasFile(), "utf8").then((s) => s.trim(), () => "");
    const name = (remembered && (await core.store.get(remembered)) ? remembered : null) ?? [...(await core.store.list())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.name;
    const state = name ? await core.store.get(name) : null;
    if (state) lastOpened = { state: await withTiles(state), focus: null };
    return lastOpened;
  });
  /** `at`: Ablegepunkt auf der Fläche; ohne ihn kommen die Bilder rechts neben das Vorhandene. */
  const addFiles = async (canvas: string | null, images: PlaceImage[], at: { x: number; y: number } | undefined, event: string) => {
    const name = canvas ?? DROP_CANVAS;
    const state = await core.store.open(name, { images, ...(at ? { at } : {}), ...(canvas ? {} : { title: t(language(), "main.dropCanvas") }) });
    core.log(event, { canvas: state.name, images: images.length, created: canvas === null });
    const shown = await withTiles(state);
    if (canvas) win?.webContents.send(EVENTS.changed, shown);
    else {
      remember({ state: shown, focus: null });
      win?.webContents.send(EVENTS.opened, lastOpened);
    }
    return shown;
  };
  ipcMain.handle(INVOKE.addImages, (_e, canvas: string | null, files: string[], at: { x: number; y: number }) =>
    addFiles(canvas, files.map((file) => ({ path: file })), at, "images_dropped"),
  );
  ipcMain.handle(INVOKE.pasteImage, async (_e, canvas: string | null, at: { x: number; y: number }) => {
    const image = await clipboardImage(language());
    if (!image) {
      core.log("paste_empty", {});
      return null;
    }
    return addFiles(canvas, [image], at, "image_pasted");
  });
  ipcMain.handle(INVOKE.nativePaste, () => win?.webContents.paste());
  ipcMain.handle(INVOKE.applyLayout, async (_e, canvas: string, layout: Layout) => {
    await core.store.applyLayout(canvas, layout);
    core.log("layout_applied", { canvas, items: layout.items.length, groups: layout.groups.length });
    await changed(canvas);
  });
  ipcMain.handle(INVOKE.removeItems, async (_e, canvas: string, ids: string[]) => {
    const removed = await core.store.removeItems(canvas, ids);
    core.log("items_removed", { canvas, items: removed.items.length, annotations: removed.annotations.length });
    await changed(canvas);
    return removed;
  });
  ipcMain.handle(INVOKE.restoreItems, async (_e, canvas: string, removed: RemovedItems) => {
    await core.store.restoreItems(canvas, removed);
    core.log("items_restored", { canvas, items: removed.items.length, groups: removed.groups.length });
    await changed(canvas);
  });
  ipcMain.handle(INVOKE.addAnnotation, async (_e, canvas: string, input: NewAnnotationInput) => {
    const annotation = await core.store.addAnnotation(canvas, input);
    core.log("annotation_add", { canvas, id: annotation.id, source: input.source });
    await changed(canvas);
    return annotation;
  });
  ipcMain.handle(INVOKE.updateAnnotation, async (_e, canvas: string, id: string, patch: AnnotationPatch) => {
    const annotation = await core.store.updateAnnotation(canvas, id, patch);
    core.log("annotation_update", { canvas, id, ...(patch.done !== undefined ? { done: patch.done !== null } : {}) });
    await changed(canvas);
    return annotation;
  });
  ipcMain.handle(INVOKE.removeAnnotation, async (_e, canvas: string, id: string) => {
    await core.store.removeAnnotation(canvas, id);
    core.log("annotation_remove", { canvas, id });
    await changed(canvas);
  });
  ipcMain.handle(INVOKE.restoreAnnotation, async (_e, canvas: string, annotation: Annotation, index: number) => {
    await core.store.restoreAnnotation(canvas, annotation, index);
    core.log("annotation_restore", { canvas, id: annotation.id });
    await changed(canvas);
  });
  ipcMain.handle(INVOKE.finish, async (_e, canvas: string) => {
    const state = await core.store.get(canvas);
    if (!state) return [];
    const finished = core.reviews.finish(state.name, reviewResult(state, new Date().toISOString()));
    core.log("review_finish", { canvas: state.name, finished, annotations: state.annotations.length });
    return finished;
  });
  ipcMain.handle(INVOKE.openReviews, () => core.reviews.open());
  ipcMain.handle(INVOKE.voice, async (_e, request: VoiceRequest) => {
    if (!voice) return { transcript: "", decision: { kind: "none", reason: "whisper_error" }, timings: { whisperMs: 0, jevMs: 0, totalMs: 0 } };
    return voice.handle({ ...request, audio: new Uint8Array(request.audio) });
  });
  ipcMain.handle(INVOKE.voiceLog, (_e, event: string, data: Record<string, unknown>) => voice?.log(event, data));

  ipcMain.handle(INVOKE.settings, () => settings.get());
  ipcMain.handle(INVOKE.saveSettings, async (_e, next: Settings) => {
    const saved = await settings.set(next);
    core.log("settings_saved", { keywords: saved.keywords.length });
    setMenu(language());
    return saved;
  });
  ipcMain.handle(INVOKE.usage, () => settings.usage());
  ipcMain.handle(INVOKE.voiceStatus, (): VoiceStatus => ({
    speech: { ready: Boolean(voice), missing: process.env.CANVAS_VOICE === "0" ? [] : speech.missing, model: speech.model && path.basename(speech.model) },
    key: decisionKey().from,
    language: language(),
  }));
  ipcMain.handle(INVOKE.setDecisionKey, (_e, key: string | null) => {
    if (key === null) {
      deleteKeychainKey();
      keychainKey = null;
      log("decision_key_removed", {});
      return true;
    }
    const ok = writeKeychainKey(String(key).trim());
    if (ok) keychainKey = String(key).trim();
    log("decision_key_saved", { ok });
    return ok;
  });

  /** Canvas in der Oberfläche zeigen, wie wenn Claude es öffnet. */
  const showOpened = async (state: CanvasState) => {
    const shown = await withTiles(state);
    remember({ state: shown, focus: null });
    win?.webContents.send(EVENTS.opened, lastOpened);
    return shown;
  };
  ipcMain.handle(INVOKE.openCanvas, async (_e, name: string) => {
    const state = await core.store.get(name);
    if (!state) throw new Error(`canvas not found: ${name}`);
    core.log("canvas_switched", { canvas: state.name });
    return showOpened(state);
  });
  ipcMain.handle(INVOKE.createCanvas, async (_e, title: string) => {
    const clean = title.trim().slice(0, 80) || t(language(), "main.newCanvas");
    const base = slugify(clean) || "canvas";
    let name = base;
    for (let i = 2; await core.store.get(name); i++) name = `${base}-${i}`;
    const state = await core.store.open(name, { title: clean, images: [] });
    core.log("canvas_created", { canvas: state.name });
    return showOpened(state);
  });
  // Erweiterungen (extensions/<name>/): Herkunftsarten für die Prüfung der Eingaben, dann eigene Kanäle.
  const extensionError = (name: string, e: unknown) => core.log("extension_error", { name, detail: String(e).slice(0, 300) });
  for (const ext of await loadExtensions<McpExtension>("mcp.ts", extensionError))
    for (const [kind, rule] of Object.entries(ext.module.origins ?? {})) registerOrigin(kind, rule);
  const extensionContext: MainExtensionContext = {
    handle(channel, fn) {
      if (!EXTENSION_CHANNEL.test(channel)) throw new Error(`extension channel not allowed: ${channel}`);
      ipcMain.handle(channel, (_e, ...args: unknown[]) => fn(...args));
    },
    log: core.log,
    dataDir: config.dataDir,
    placeImages: (canvas, images) => addFiles(canvas, images, undefined, "extension_placed"),
  };
  for (const ext of await loadExtensions<MainExtension>("main.ts", extensionError)) {
    try {
      await ext.module.register(extensionContext);
      core.log("extension_loaded", { name: ext.name });
    } catch (e) {
      extensionError(ext.name, e);
    }
  }

  // Vorschaubilder für Listen: klein, als JPEG, im Speicher gehalten (Schlüssel: Datei, Ausschnitt, Größe).
  const thumbs = new Map<string, string>();
  ipcMain.handle(INVOKE.thumbnail, async (_e, req: ThumbnailRequest) => {
    const item = (await core.store.get(req.canvas))?.items.find((i) => i.id === req.itemId);
    if (!item) return null;
    const size = Math.min(Math.max(16, Math.round(req.size)), 800);
    const key = `${item.path}|${req.rect?.join(",") ?? "ganz"}|${size}`;
    const known = thumbs.get(key);
    if (known) return known;
    try {
      // Ganze Seiten sind oft sehr hoch: Als Vorschau zählt dann ihr Kopf, nicht ein dünner Streifen.
      const tall = item.imageHeight > item.imageWidth * 1.2;
      const head: Rect = [0, 0, item.imageWidth, Math.round(item.imageWidth * 0.7)];
      const img = req.rect
        ? await cropAnnotation(item, { rect: req.rect } as Annotation, size)
        : tall
          ? await cropRect(item, head, size)
          : await previewImage(item, size);
      const url = `data:${img.mimeType};base64,${img.data}`;
      if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
      thumbs.set(key, url);
      return url;
    } catch {
      return null;
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    voice?.stop();
    for (const review of core.reviews.open()) core.reviews.cancel(review.reviewId, "app_closed");
  });

  win = createWindow();
});

/**
 * Bild aus der Zwischenablage: eine im Finder kopierte Bilddatei über ihren Pfad, sonst ein kopiertes Bild als PNG
 * unter data/pasted. Null, wenn kein Bild da ist.
 */
async function clipboardImage(lang: Language): Promise<{ path: string; title?: string } | null> {
  const items = await clipboard.read();
  const blobOf = async (type: string) => {
    const item = items.find((i) => i.types.includes(type));
    return item ? ((await item.getType(type)) as Blob) : null;
  };
  const url = (await (await blobOf(FILE_URL))?.text())?.replace(/\0+$/, "").trim();
  if (url?.startsWith("file://")) {
    const file = decodeURIComponent(new URL(url).pathname);
    if (IMAGE_FILE.test(file)) return { path: file };
  }
  let png = await blobOf("image/png");
  let bytes: Buffer | null = png ? Buffer.from(await png.arrayBuffer()) : null;
  if (!bytes) {
    for (const t of TIFF) {
      const tiff = await blobOf(t);
      if (tiff) {
        bytes = await sharp(Buffer.from(await tiff.arrayBuffer())).png().toBuffer();
        break;
      }
    }
  }
  if (!bytes) return null;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  await fs.mkdir(paths.pasted(), { recursive: true });
  const file = path.join(paths.pasted(), `pasted-${stamp}-${String(d.getMilliseconds()).padStart(3, "0")}.png`);
  await fs.writeFile(file, bytes);
  return { path: file, title: t(lang, "main.pasted", { time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }) };
}
