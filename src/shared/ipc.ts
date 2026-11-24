// Brücke zwischen Oberfläche und Hauptprozess (Electron IPC): Kanalnamen und Typen an einer Stelle.
// preload.cjs führt dieselben Namen als Freigabeliste; ipc.test.ts prüft, dass beide übereinstimmen.

import type { Annotation, AnnotationDone, AnnotationSource, CanvasState, CanvasSummary, Layout, Rect, RemovedItems, RemovedVersions, ReviewStatus } from "./contracts.ts";
import type { Language, Settings } from "./settings.ts";
import type { UsageSummary } from "./usage.ts";
import type { VoiceRequest, VoiceResult } from "./voice.ts";
import type { ExtensionChannel } from "./extensions.ts";

export const INVOKE = {
  list: "canvas:list",
  get: "canvas:get",
  current: "canvas:current",
  addImages: "canvas:add-images",
  pasteImage: "canvas:paste-image",
  nativePaste: "edit:native-paste",
  applyLayout: "canvas:apply-layout",
  removeItems: "canvas:remove-items",
  restoreItems: "canvas:restore-items",
  removeVersions: "canvas:remove-versions",
  restoreVersions: "canvas:restore-versions",
  addAnnotation: "annotation:add",
  updateAnnotation: "annotation:update",
  removeAnnotation: "annotation:remove",
  restoreAnnotation: "annotation:restore",
  finish: "review:finish",
  openReviews: "review:open-list",
  voice: "voice:utterance",
  voiceLog: "voice:log",
  settings: "settings:get",
  saveSettings: "settings:set",
  usage: "usage:get",
  voiceStatus: "voice:status",
  setDecisionKey: "settings:set-key",
  openCanvas: "canvas:open",
  createCanvas: "canvas:create",
  thumbnail: "canvas:thumbnail",
} as const;

export const EVENTS = {
  opened: "canvas:opened",
  changed: "canvas:changed",
  reviews: "reviews:changed",
  stage: "view:stage",
  /** Menü „Bearbeiten → Widerrufen / Wiederholen“ (Cmd+Z, Cmd+Shift+Z): Das Menü fängt die Tasten ab. */
  undo: "edit:undo",
  redo: "edit:redo",
  /** Menü „Bearbeiten → Einsetzen“ (Cmd+V): auf dem Canvas ein Bild aus der Zwischenablage, in Textfeldern Text. */
  paste: "edit:paste",
  /** Menü „Canvas → Einstellungen …“ (Cmd+,). */
  openSettings: "view:settings",
  /** Menü „Ablage → Canvas öffnen …“ (Cmd+O) und „Neuer Canvas …“ (Cmd+N). */
  openCanvases: "view:canvases",
  newCanvas: "view:new-canvas",
} as const;


/** Grund unter den Screenshots, umschaltbar im Menü „Ansicht“. */
export type Stage = "light" | "dark";

/** Fläche, die entsteht, wenn Bilder ohne offene Fläche abgelegt werden. */
export const DROP_CANVAS = "ablage";

export type OpenReview = Extract<ReviewStatus, { status: "open" }>;
export type OpenedEvent = { state: CanvasState; focus: string | null };
export type AnnotationPatch = { note?: string; rect?: Rect; done?: Pick<AnnotationDone, "by" | "reply"> | null };
export type NewAnnotationInput = { itemId: string; rect: Rect; note: string; source: AnnotationSource };
/** Vorschaubild eines Bildes auf einem Canvas, mit `rect` (Bildpixel) nur der Ausschnitt samt etwas Rand. */
export type ThumbnailRequest = { canvas: string; itemId: string; rect?: Rect; size: number };

/** Was die Oberfläche vom Hauptprozess bekommt. Bilder lädt sie als Kacheln über `canvas-tile://`. */
export interface CanvasBridge {
  list(): Promise<CanvasSummary[]>;
  get(name: string): Promise<CanvasState | null>;
  /** Zuletzt von Claude geöffnete Fläche, falls die Oberfläche das Ereignis verpasst hat (etwa beim Laden). */
  current(): Promise<OpenedEvent | null>;
  /**
   * Bilddateien ablegen, etwa aus dem Finder gezogen. `at` ist der Punkt auf der Fläche, an dem losgelassen
   * wurde. Ohne offene Fläche (`canvas` null) entsteht die Fläche „Ablage“ und öffnet sich.
   */
  addImages(canvas: string | null, paths: string[], at: { x: number; y: number }): Promise<CanvasState>;
  /**
   * Bild aus der Zwischenablage auf das Canvas (⌘V): eine im Finder kopierte Bilddatei über ihren Pfad, sonst ein
   * kopiertes Bild (Screenshot, Browser, Figma), abgelegt unter data/pasted. Landet bei `at` wie ein abgelegtes
   * Bild. Null, wenn kein Bild da ist.
   */
  pasteImage(canvas: string | null, at: { x: number; y: number }): Promise<CanvasState | null>;
  /** Normales Einsetzen in das Textfeld mit dem Fokus. */
  nativePaste(): Promise<void>;
  /** Anordnung setzen: Lage von Bildern und alle Gruppen. */
  applyLayout(canvas: string, layout: Layout): Promise<void>;
  /** Bilder samt Anmerkungen löschen; gibt zurück, was „Rückgängig“ braucht. */
  removeItems(canvas: string, ids: string[]): Promise<RemovedItems>;
  restoreItems(canvas: string, removed: RemovedItems): Promise<void>;
  /** Frühere Fassungen eines Bildes löschen (Indizes in `versions`), samt ihren Anmerkungen; für „Rückgängig“. */
  removeVersions(canvas: string, itemId: string, indices: number[]): Promise<RemovedVersions>;
  restoreVersions(canvas: string, removed: RemovedVersions): Promise<void>;
  /** Dateipfad zu einer gezogenen Datei; leer, wenn die Datei keinen Pfad hat. */
  pathForFile(file: File): string;
  addAnnotation(canvas: string, input: NewAnnotationInput): Promise<Annotation>;
  /** `done`: erledigt (von Hand) oder mit null wieder offen. */
  updateAnnotation(canvas: string, id: string, patch: AnnotationPatch): Promise<Annotation>;
  removeAnnotation(canvas: string, id: string): Promise<void>;
  /** Rückgängig nach dem Löschen: dieselbe Anmerkung wieder an ihre alte Stelle (Nummer bleibt). */
  restoreAnnotation(canvas: string, annotation: Annotation, index: number): Promise<void>;
  /** „Fertig“: beendet alle Besprechungen dieser Fläche, gibt deren IDs zurück. */
  finish(canvas: string): Promise<string[]>;
  openReviews(): Promise<OpenReview[]>;
  /** Eine Aufnahme: Text erkennen und Befehl bestimmen. Ausführen tut die Oberfläche. */
  voice(request: VoiceRequest): Promise<VoiceResult>;
  /** Was die Oberfläche mit einer Entscheidung gemacht hat, fürs Protokoll. */
  voiceLog(event: string, data: Record<string, unknown>): Promise<void>;
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  /** Kosten von Jev: heute, Mittel je Tag, laufender Monat. */
  usage(): Promise<UsageSummary>;
  /** Was die Sprache kann: Erkennung da oder was fehlt, Schlüssel für das Entscheidungsmodell, Sprache. */
  voiceStatus(): Promise<VoiceStatus>;
  /** Schlüssel in die Keychain (null: löschen). Falsch, wenn er nicht gespeichert werden konnte. */
  setDecisionKey(key: string | null): Promise<boolean>;
  /** Vorhandenes Canvas öffnen, wie wenn Claude es öffnet. */
  openCanvas(name: string): Promise<CanvasState>;
  /** Leeres Canvas mit diesem Titel anlegen und öffnen; der Name wird eindeutig gemacht. */
  createCanvas(title: string): Promise<CanvasState>;
  /** Vorschaubild als data-URL (JPEG). */
  thumbnail(request: ThumbnailRequest): Promise<string | null>;
  /** Kanal einer Erweiterung (ext:<erweiterung>:<name>, siehe src/shared/extensions.ts). */
  invokeExtension(channel: ExtensionChannel, ...args: unknown[]): Promise<unknown>;
  onOpened(cb: (event: OpenedEvent) => void): () => void;
  onChanged(cb: (state: CanvasState) => void): () => void;
  onReviews(cb: (reviews: OpenReview[]) => void): () => void;
  onStage(cb: (stage: Stage) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onOpenCanvases(cb: () => void): () => void;
  onNewCanvas(cb: () => void): () => void;
  onUndo(cb: () => void): () => void;
  onRedo(cb: () => void): () => void;
  onPaste(cb: () => void): () => void;
}

/** Roh-Schnittstelle, die preload.cjs ins Fenster legt. */
export interface RawBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** Nur Kanäle der Form ext:<erweiterung>:<name>. */
  invokeExtension(channel: string, ...args: unknown[]): Promise<unknown>;
  pathForFile(file: File): string;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

/** Kacheln eines Bildes: `canvas-tile://<schlüssel>/<stufe>/<spalte>_<zeile>.png`. */
export const TILE_SCHEME = "canvas-tile";
export const tileBaseUrl = (key: string) => `${TILE_SCHEME}://${key}`;

/**
 * Stand der Sprache. `speech`: Erkennung bereit oder was fehlt. `key`: woher der Schlüssel kommt (Umgebung, Keychain)
 * oder null. Ohne Schlüssel gehen nur Befehle, die der Code eindeutig erkennt, und Diktat.
 */
export type VoiceStatus = {
  speech: { ready: boolean; missing: ("whisper" | "model" | "ffmpeg")[]; model: string | null };
  key: "env" | "keychain" | null;
  language: Language;
};
