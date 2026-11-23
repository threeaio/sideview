// Verträge zwischen MCP-Server, App-Hauptprozess und Oberfläche. Nur Typen und Konstanten.
// Fehler gehen als Code über die Grenze, Text entsteht erst an der Oberfläche oder im MCP-Ergebnis.

/** Rechteck in Bildpixeln: x, y, Breite, Höhe. */
export type Rect = [x: number, y: number, w: number, h: number];

/** Benannter Bereich eines Screenshots, etwa der Kopf einer Seite. */
export type Region = {
  label: string;
  kind: "head" | "section" | "foot";
  heading: string | null;
  aliases: string[];
  rect: Rect;
};

/** Kachelpyramide eines Bildes (Deep Zoom). Stufe maxLevel ist das Original. */
export type TileManifest = {
  key: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: "png";
  maxLevel: number;
  levels: { level: number; width: number; height: number; cols: number; rows: number }[];
};

/** Ein Bild auf der Fläche. Lage und Größe in Flächeneinheiten, `scale` Bildpixel je Einheit. */
/**
 * Woher ein Bild kommt, damit Claude es auf Wunsch neu holen kann. Die App merkt es sich, Claude fragt es mit sideview_get ab.
 * figma: Adresse des Frames mit node-id (nie die kurzlebige Bildadresse). web: Seite, `detail` = Ansicht (desktop, mobile).
 * file: Pfad der Datei. url: Bildadresse im Netz. Erweiterungen melden weitere Arten an (src/shared/origins.ts).
 */
export type OriginKind = string;
export type ImageOrigin = { kind: OriginKind; ref: string; detail?: string; fetchedAt: string };
export type OriginInput = Omit<ImageOrigin, "fetchedAt">;

export type ImageMeta = Record<string, unknown>;
/** Obergrenze für `meta` als JSON-Text: ein kleines Objekt, kein Ablageort für Inhalte. */
export const META_MAX_CHARS = 2000;

export type ImageItem = {
  id: string;
  path: string;
  title: string;
  /** Fehlt bei Bildern, die vor dem 5.11.2026 nachts auf die Fläche kamen. */
  origin?: ImageOrigin;
  /** Freie Angaben von Claude zum Wiederfinden (Fassung, Projekt, Commit …). Die App liest sie nicht aus. */
  meta?: ImageMeta;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  x: number;
  y: number;
  regions: Region[];
  /**
   * Frühere Fassungen, die älteste zuerst (22.11.: beim Ersetzen nicht wegwerfen, als Stapel zeigen).
   * Fehlt, solange das Bild nie ersetzt wurde.
   */
  versions?: ImageVersion[];
  /** Abgeleitet, nicht gespeichert: Kacheln für die Fläche, sobald sie erzeugt sind. */
  tiles?: TileManifest;
};

/** Eine ersetzte Fassung eines Bildes: was es vor dem Tausch war, und wann getauscht wurde. */
export type ImageVersion = {
  path: string;
  title: string;
  origin?: ImageOrigin;
  meta?: ImageMeta;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  replacedAt: string;
};

/** Gruppe von Bildern mit Namen, etwa eine Figma-Section. Ihre Fläche ergibt sich aus den Bildern (shared/groups.ts). */
/** `maxWidth`: vom Nutzer gezogene größte Breite der Reihe (ohne Rand), in Canvas-Einheiten; fehlt sie, gilt die Vorgabe. */
export type Group = { id: string; title: string; itemIds: string[]; maxWidth?: number };

/** Anordnung: Lage der genannten Bilder (Canvas-Einheiten) und alle Gruppen mit ihrer Reihenfolge. Rückgängig setzt
 * einfach die Anordnung von vorher. */
export type Layout = { items: { id: string; x: number; y: number }[]; groups: Group[] };

/** Was beim Löschen von Bildern wegfiel, damit „Rückgängig“ es zurückbringt: Bilder, ihre Anmerkungen, Gruppen vorher,
 * dazu die Reihenfolge aller Bilder (sie bestimmt, was oben liegt und wie das Inhaltsverzeichnis sortiert ist). */
export type RemovedItems = { items: ImageItem[]; annotations: Annotation[]; groups: Group[]; order?: string[] };

export type AnnotationSource = "voice" | "text" | "claude";

/**
 * Anmerkung zu einem Bild. `rect` in Bildpixeln, damit sie beim Verschieben des Bildes mitwandert.
 * Ein Punkt (22.11.: „Notiz als Punkt“) ist ein Rechteck ohne Breite und Höhe.
 */
export type Annotation = {
  id: string;
  itemId: string;
  rect: Rect;
  note: string;
  createdAt: string;
  source: AnnotationSource;
  /** Erledigt (22.11.: „nicht löschen, sondern erledigt“), mit Claudes Antwort; fehlt, solange offen. */
  done?: AnnotationDone;
};

/** Wer erledigt hat: Claude nach dem Umsetzen, mit kurzer Antwort, oder der Nutzer von Hand. */
export type AnnotationDone = { at: string; by: "claude" | "user"; reply?: string };

export const isPoint = (rect: Rect) => rect[2] === 0 && rect[3] === 0;

/**
 * Claude entfernt Anmerkungen, die der Nutzer weghaben will. Umgesetzte markiert Claude als erledigt (ResolveRequest).
 * `refs`: id der Anmerkung oder ihre Nummer, wie sie auf dem Canvas steht („3“), beides vor dem Entfernen gezählt.
 */
export type RemoveAnnotationsRequest = { refs: string[] };
export type RemoveAnnotationsResponse = { canvas: CanvasState; removed: string[] };
/** Claude hat Anmerkungen umgesetzt: je Nummer oder id eine kurze Antwort, was getan wurde. */
export type ResolveRequest = { annotations: { ref: string; reply?: string }[] };
export type ResolveResponse = { canvas: CanvasState; resolved: string[] };
/** Länge einer Antwort von Claude an einer Anmerkung. */
export const REPLY_MAX_CHARS = 600;
/** Bilder (id, Nummer, Titel) oder Gruppen (id, Titel) entfernen; eine Gruppe nimmt ihre Bilder mit. */
export type RemoveRequest = { images?: string[]; groups?: string[] };
export type RemoveResponse = { canvas: CanvasState; removed: string[]; groups: string[] };

export type CanvasState = {
  name: string;
  title: string;
  items: ImageItem[];
  groups: Group[];
  annotations: Annotation[];
  updatedAt: string;
};

export type CanvasSummary = {
  name: string;
  title: string;
  items: number;
  /** Offene Anmerkungen; erledigte zählen in `done`. */
  annotations: number;
  done: number;
  updatedAt: string;
  /** Erstes Bild, als Vorschau in der Liste der Canvases. */
  cover?: string;
};

export type ReviewResult = {
  canvas: string;
  finishedAt: string;
  annotations: Annotation[];
  items: ImageItem[];
  groups: Group[];
};

export type ReviewStatus =
  | { status: "open"; reviewId: string; canvas: string; prompt: string | null }
  | { status: "done"; reviewId: string; canvas: string; result: ReviewResult }
  | { status: "cancelled"; reviewId: string; canvas: string; reason: CancelReason };

export type CancelReason = "claude_aborted" | "user_cancelled" | "app_closed";

export type ApiErrorCode = "unauthorized" | "not_found" | "bad_request" | "image_missing" | "internal";
export type ApiError = { error: ApiErrorCode; detail?: string };

/**
 * `at`: Punkt auf der Fläche (Flächeneinheiten), an dem Bilder abgelegt wurden, etwa beim Ziehen aus dem Finder.
 * Ohne `at` kommen neue Bilder rechts neben die vorhandenen.
 * `group`: Name einer Gruppe, in die die Bilder kommen (gibt es sie schon, kommen sie dazu), etwa die Figma-Section.
 * Je Bild: `origin` (sonst leitet die App sie ab: page-shots oder Datei), `replaces` = id eines Bildes, das an Ort und
 * Stelle getauscht wird; Lage, Gruppe, Name und Anmerkungen bleiben. `meta`: freie Angaben zum Wiederfinden; ersetzt
 * die alten, ohne `meta` bleiben sie. Liegt das Bild schon da (gleicher Pfad), setzt `meta` nur die Angaben neu.
 */
export type OpenImage = { path: string; title?: string; origin?: OriginInput; replaces?: string; meta?: ImageMeta };
export type OpenRequest = { title?: string; images: OpenImage[]; focus?: string; at?: { x: number; y: number }; group?: string };
export type OpenResponse = { canvas: CanvasState; focus: string | null };
export type ReviewRequest = { prompt?: string; toolUseId?: string };
export type ReviewStartResponse = { reviewId: string };
export type HealthResponse = { ok: true; pid: number; version: string };

/** Wie lange ein einzelnes Warten auf „Fertig“ dauert, bevor der MCP-Server neu fragt. */
export const REVIEW_WAIT_MS = 25_000;
