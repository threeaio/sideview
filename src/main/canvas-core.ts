// Reine Funktionen für Flächen: Anordnung neuer Bilder, Umwandlung von und nach JSON Canvas 1.0.
// Keine Dateizugriffe. JSON Canvas: https://jsoncanvas.org/spec/1.0/

import { originKindProblem } from "../shared/origins.ts";
import { META_MAX_CHARS, type Annotation, type CanvasState, type CanvasSummary, type Group, type ImageItem, type ImageMeta, type ImageOrigin, type ImageVersion, type OriginInput, type Rect } from "../shared/contracts.ts";
import { GROUP_PAD, groupArea } from "../shared/groups.ts";
export { slugify } from "../shared/names.ts";

export const GAP = 200;

/** Knoten einer JSON-Canvas-Datei. Eigene Felder liegen unter `canvas`, andere Programme übergehen sie. */
type JsonCanvasFileNode = {
  id: string;
  type: "file";
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  canvas?: { title: string; origin?: ImageOrigin; meta?: ImageMeta; imageWidth: number; imageHeight: number; scale: number; versions?: ImageVersion[]; annotations: Annotation[] };
};
/** Gruppe in JSON Canvas: Lage und Name für andere Programme, die Mitglieder unter `canvas.items`. */
type JsonCanvasGroupNode = { id: string; type: "group"; label: string; x: number; y: number; width: number; height: number; canvas?: { items: string[]; maxWidth?: number } };
type JsonCanvasNode = JsonCanvasFileNode | JsonCanvasGroupNode | { id: string; type: string; [key: string]: unknown };
export type JsonCanvasFile = {
  nodes: JsonCanvasNode[];
  edges: unknown[];
  canvas?: { title: string; updatedAt: string };
};

export function emptyCanvas(name: string, title: string, now: string): CanvasState {
  return { name, title, items: [], groups: [], annotations: [], updatedAt: now };
}

/**
 * Neue Bilder rechts neben die vorhandenen, oben bündig, mit festem Abstand. Gruppenflächen zählen mit.
 * `into`: die Gruppe, in die das Bild kommt. Beginnt mit ihm eine neue Gruppe, hält es Abstand für deren Rand.
 */
export function placeRight(items: ImageItem[], groups: Group[] = [], into: Group | null = null): { x: number; y: number } {
  if (items.length === 0) return { x: 0, y: 0 };
  const edges = items.map((i) => i.x + i.imageWidth / i.scale);
  // Gruppen, in die das neue Bild nicht kommt, reichen mit ihrem Rand weiter nach rechts.
  for (const g of groups) {
    const area = g === into ? null : groupArea(g, items);
    if (area) edges.push(area.x + area.w);
  }
  const startsGroup = into !== null && into.itemIds.length === 0;
  return { x: Math.max(...edges) + GAP + (startsGroup ? GROUP_PAD : 0), y: 0 };
}

/**
 * Abgelegtes Bild: Das erste sitzt mittig auf dem Punkt, an dem losgelassen wurde. Jedes weitere
 * kommt rechts neben das vorige, oben bündig mit ihm.
 */
export function placeDropped(at: { x: number; y: number }, size: { width: number; height: number }, previous: ImageItem | null): { x: number; y: number } {
  if (!previous) return { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) };
  return { x: previous.x + itemSize(previous).width + GAP, y: previous.y };
}

/** Woher ein Screenshot stammt, laut regions.json von page-shots: Adresse und Ansicht. */
export type PageOrigin = { source: string; view: string };

const VIEW_NAMES: Record<string, string> = { desktop: "Desktop", mobile: "Handy" };

/** „https://www.heise.de/news“ → „heise.de“. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Name eines Bildes, wenn Claude keinen mitgibt. Ein Screenshot von page-shots heißt nach Seite und Ansicht
 * („heise.de Handy“), sonst zählt der Dateiname ohne Endung. Nie nur „desktop“, denn über den Namen spricht man es an.
 */
export function defaultTitle(imagePath: string, page: PageOrigin | null): string {
  if (page) return `${siteName(page.source)} ${VIEW_NAMES[page.view] ?? page.view}`;
  const parts = imagePath.split("/");
  const base = parts.pop()!.replace(/\.[a-z0-9]+$/i, "");
  if (!(base.toLowerCase() in VIEW_NAMES)) return base;
  // Nur „desktop“ sagt nichts: den Ordner davor nehmen, einen Ordner „shots“ überspringen.
  const folder = parts.at(-1) === "shots" ? parts.at(-2) : parts.at(-1);
  return folder ? `${folder} ${VIEW_NAMES[base.toLowerCase()]}` : base;
}

/** Jeder Name nur einmal je Fläche: der zweite „heise.de Handy“ heißt „heise.de Handy 2“. */
export function uniqueTitle(title: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(title.toLowerCase())) return title;
  for (let n = 2; ; n++) if (!used.has(`${title} ${n}`.toLowerCase())) return `${title} ${n}`;
}

export function itemSize(item: ImageItem): { width: number; height: number } {
  return { width: item.imageWidth / item.scale, height: item.imageHeight / item.scale };
}

export function toJsonCanvas(state: CanvasState): JsonCanvasFile {
  // Gruppen zuerst: In JSON Canvas liegen frühere Knoten unten.
  const groups: JsonCanvasGroupNode[] = state.groups.flatMap((g) => {
    const area = groupArea(g, state.items);
    if (!area) return [];
    return [{ id: g.id, type: "group", label: g.title, x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.w), height: Math.round(area.h), canvas: { items: g.itemIds, ...(g.maxWidth ? { maxWidth: Math.round(g.maxWidth) } : {}) } }];
  });
  return {
    nodes: [...groups, ...state.items.map((item) => {
      const { width, height } = itemSize(item);
      return {
        id: item.id,
        type: "file",
        file: item.path,
        x: Math.round(item.x),
        y: Math.round(item.y),
        width: Math.round(width),
        height: Math.round(height),
        canvas: {
          title: item.title,
          ...(item.origin ? { origin: item.origin } : {}),
          ...(item.meta ? { meta: item.meta } : {}),
          imageWidth: item.imageWidth,
          imageHeight: item.imageHeight,
          scale: item.scale,
          ...(item.versions?.length ? { versions: item.versions } : {}),
          annotations: state.annotations.filter((a) => a.itemId === item.id),
        },
      };
    })],
    edges: [],
    canvas: { title: state.title, updatedAt: state.updatedAt },
  };
}

/** Liest eine JSON-Canvas-Datei. Bereiche sind abgeleitet und kommen nicht aus der Datei. */
export function fromJsonCanvas(name: string, file: JsonCanvasFile): CanvasState {
  const items: ImageItem[] = [];
  const annotations: Annotation[] = [];
  const groups: Group[] = [];
  for (const node of file.nodes) {
    if (node.type === "group") {
      const g = node as JsonCanvasGroupNode;
      groups.push({ id: g.id, title: g.label ?? "Gruppe", itemIds: g.canvas?.items ?? [], ...(typeof g.canvas?.maxWidth === "number" && g.canvas.maxWidth > 0 ? { maxWidth: g.canvas.maxWidth } : {}) });
      continue;
    }
    if (node.type !== "file" || !isFileNode(node)) continue;
    const meta = node.canvas;
    items.push({
      id: node.id,
      path: node.file,
      title: meta?.title ?? node.file.split("/").pop() ?? node.id,
      ...(meta?.origin ? { origin: meta.origin } : {}),
      ...(meta?.meta ? { meta: meta.meta } : {}),
      imageWidth: meta?.imageWidth ?? node.width,
      imageHeight: meta?.imageHeight ?? node.height,
      scale: meta?.scale ?? 1,
      ...(Array.isArray(meta?.versions) && meta.versions.length ? { versions: meta.versions } : {}),
      x: node.x,
      y: node.y,
      regions: [],
    });
    annotations.push(...(meta?.annotations ?? []));
  }
  return {
    name,
    title: file.canvas?.title ?? name,
    items,
    // Nur Mitglieder, die es noch gibt; leere Gruppen fallen weg.
    groups: groups.map((g) => ({ ...g, itemIds: g.itemIds.filter((id) => items.some((i) => i.id === id)) })).filter((g) => g.itemIds.length > 0),
    annotations,
    updatedAt: file.canvas?.updatedAt ?? new Date(0).toISOString(),
  };
}

function isFileNode(node: JsonCanvasNode): node is JsonCanvasFileNode {
  return typeof (node as JsonCanvasFileNode).file === "string";
}

export function summarize(state: CanvasState): CanvasSummary {
  return {
    name: state.name,
    title: state.title,
    items: state.items.length,
    annotations: state.annotations.filter((a) => !a.done).length,
    done: state.annotations.filter((a) => a.done).length,
    updatedAt: state.updatedAt,
    ...(state.items[0] ? { cover: state.items[0].id } : {}),
  };
}

/**
 * Vor dem Tausch (`replaces`): die bisherige Fassung oben auf den Stapel. Kommt dieselbe Datei noch einmal, entsteht
 * keine neue Fassung.
 */
export function stackVersion(item: ImageItem, nextPath: string, at: string): ImageVersion[] {
  const versions = item.versions ?? [];
  if (item.path === nextPath) return versions;
  const version: ImageVersion = {
    path: item.path,
    title: item.title,
    ...(item.origin ? { origin: item.origin } : {}),
    ...(item.meta ? { meta: item.meta } : {}),
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    scale: item.scale,
    replacedAt: at,
  };
  return [...versions, version];
}

/** Begrenzt ein Rechteck auf die Bildfläche. */
export function clampRect([x, y, w, h]: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.min(width, Math.round(x)));
  const y0 = Math.max(0, Math.min(height, Math.round(y)));
  const x1 = Math.max(x0, Math.min(width, Math.round(x + w)));
  const y1 = Math.max(y0, Math.min(height, Math.round(y + h)));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Fehler in einer angegebenen Herkunft, sonst null. Figma nur als Adresse der Datei, nie als kurzlebige Bildadresse. */
/** Prüft `meta`: ein JSON-Objekt (kein Feld, keine Liste), klein genug. */
export function metaProblem(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return "meta: a JSON object";
  if (JSON.stringify(meta).length > META_MAX_CHARS) return `meta: at most ${META_MAX_CHARS} characters as JSON`;
  return null;
}

export function originProblem(o: OriginInput): string | null {
  if (!o.ref?.trim()) return "origin.ref missing";
  return originKindProblem(o.kind, o.ref);
}

/** Herkunft eines Bildes: angegeben, sonst aus page-shots (Seite und Ansicht), sonst die Datei. */
export function resolveOrigin(given: OriginInput | undefined, page: { source: string; view: string } | null, file: string, at: string): ImageOrigin {
  if (given) return { kind: given.kind, ref: given.ref.trim(), ...(given.detail?.trim() ? { detail: given.detail.trim() } : {}), fetchedAt: at };
  if (page) return { kind: "web", ref: page.source, detail: page.view, fetchedAt: at };
  return { kind: "file", ref: file, fetchedAt: at };
}

/**
 * Anmerkungen über id oder Nummer finden. Nummern zählen wie auf dem Canvas (1 = erste), alle vor der Änderung,
 * damit „entferne 2 und 3“ nicht nach dem ersten Entfernen verrutscht. Unbekannte Angaben kommen als `missing` zurück.
 */
export function resolveAnnotations(annotations: Annotation[], refs: string[]): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim().replace(/^#/, "");
    const byId = annotations.find((a) => a.id === ref);
    const byNumber = /^\d+$/.test(ref) ? annotations[Number(ref) - 1] : undefined;
    const hit = byId ?? byNumber;
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else missing.push(raw);
  }
  return { ids, missing };
}

/**
 * Für Claude: welche Bilder ein Entfernen trifft. Bilder über id, Nummer (wie in sideview_get) oder Titel;
 * Gruppen über id oder Titel, eine Gruppe trifft alle ihre Bilder. Titel ohne Groß- und Kleinschreibung,
 * nur eindeutige. Was sich nicht auflösen lässt, steht in `missing`.
 */
export function resolveRemoval(state: Pick<CanvasState, "items" | "groups">, refs: { images?: string[]; groups?: string[] }): { ids: string[]; groups: string[]; missing: string[] } {
  const ids: string[] = [];
  const groups: string[] = [];
  const missing: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const byTitle = <T extends { title: string }>(list: T[], ref: string) => {
    const hits = list.filter((x) => x.title.trim().toLowerCase() === ref.toLowerCase());
    return hits.length === 1 ? hits[0] : undefined;
  };
  for (const raw of refs.images ?? []) {
    const ref = raw.trim().replace(/^#/, "");
    const hit = state.items.find((i) => i.id === ref) ?? (/^\d+$/.test(ref) ? state.items[Number(ref) - 1] : undefined) ?? byTitle(state.items, ref);
    if (hit) add(hit.id);
    else missing.push(`Bild ${raw}`);
  }
  for (const raw of refs.groups ?? []) {
    const ref = raw.trim();
    const hit = state.groups.find((g) => g.id === ref) ?? byTitle(state.groups, ref);
    if (!hit) {
      missing.push(`Gruppe ${raw}`);
      continue;
    }
    if (!groups.includes(hit.title)) groups.push(hit.title);
    hit.itemIds.forEach(add);
  }
  return { ids, groups, missing };
}
