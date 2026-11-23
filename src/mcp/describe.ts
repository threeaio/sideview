// Texte für Claude aus Daten der App. Reine Funktionen, damit sie testbar bleiben.

import type { Annotation, CanvasState, CanvasSummary, Group, ImageItem, ImageOrigin, Rect, ReviewResult } from "../shared/contracts.ts";
import { originLabel } from "../shared/origins.ts";
import { regionAt } from "./crops.ts";

const fmtRect = ([x, y, w, h]: number[], unit = " px") => `x ${x}, y ${y}, ${w} × ${h}${unit}`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeList(canvases: CanvasSummary[]): string {
  if (canvases.length === 0) return "There is no canvas yet.";
  return [
    `${count(canvases.length, "canvas", "canvases")}, newest first:`,
    ...canvases.map((c) => `- ${c.title} (name: ${c.name}): ${count(c.items, "image", "images")}, ${count(c.annotations, "open annotation", "open annotations")}${c.done ? `, ${c.done} resolved` : ""}, last changed ${c.updatedAt}`),
  ].join("\n");
}

export function describeItem(item: ImageItem, index: number): string {
  const regions = item.regions.length ? ` Regions: ${item.regions.map((r) => r.label).join(" | ")}.` : " No named regions.";
  return `${index + 1}. ${item.title} (id ${item.id}), ${item.imageWidth} × ${item.imageHeight} px, ${item.path}.${regions}`;
}

const r0 = (n: number) => Math.round(n);

/** Rechteck in Bildpixeln auf das Canvas umgerechnet: Lage des Bildes plus Pixel geteilt durch den Maßstab. */
export function onCanvas(item: Pick<ImageItem, "x" | "y" | "scale">, [x, y, w, h]: Rect): Rect {
  return [r0(item.x + x / item.scale), r0(item.y + y / item.scale), r0(w / item.scale), r0(h / item.scale)];
}


export function describeOrigin(o: ImageOrigin | undefined): string {
  if (!o) return "Origin unknown (placed before the canvas remembered origins).";
  return `Origin: ${originLabel(o.kind)} ${o.ref}${o.detail ? ` ("${o.detail}")` : ""}, fetched ${o.fetchedAt}.`;
}

/** Ein Bild mit allem, was die App weiß: Datei, Größe, Lage, Gruppe, Herkunft, Bereiche mit Koordinaten. */
export function describeItemFull(item: ImageItem, groups: Group[], index: number): string {
  const group = groups.find((g) => g.itemIds.includes(item.id));
  const [, , w, h] = onCanvas(item, [0, 0, item.imageWidth, item.imageHeight]);
  const lines = [
    `${index + 1}. ${item.title} (id ${item.id})${group ? `, group "${group.title}"` : ""}`,
    `   File ${item.path}, ${item.imageWidth} × ${item.imageHeight} px, scale ${item.scale}`,
    `   On the canvas: ${fmtRect([r0(item.x), r0(item.y), w, h], "")}`,
    `   ${describeOrigin(item.origin)}`,
  ];
  if (item.meta) lines.push(`   Meta: ${JSON.stringify(item.meta)}`);
  if (item.versions?.length)
    lines.push(
      `   Earlier versions (${item.versions.length}, oldest first; stacked behind the image): ` +
        item.versions.map((v, i) => `${i + 1}. ${v.title}, ${v.path}, ${v.imageWidth} × ${v.imageHeight} px, replaced ${v.replacedAt}${v.meta ? `, meta ${JSON.stringify(v.meta)}` : ""}`).join("; "),
    );
  if (item.regions.length) lines.push(`   Regions: ${item.regions.map((r) => `${r.label} [${fmtRect(r.rect)}]`).join("; ")}`);
  return lines.join("\n");
}

/** Ganzer Stand eines Canvas für sideview_get: Bilder, Gruppen, Anmerkungen, alles mit Koordinaten. */
export function describeCanvas(state: CanvasState): string {
  return [
    `Canvas "${state.title}" (name: ${state.name}), as of ${state.updatedAt}.`,
    "Coordinates: images in canvas units, origin top left. Regions and annotations in image pixels (origin top left of the image), annotations also on the canvas.",
    state.items.length ? `${count(state.items.length, "image", "images")}:` : "No images.",
    ...state.items.map((item, i) => describeItemFull(item, state.groups, i)),
    describeAnnotations(state),
  ].join("\n");
}

export function describeOpen(state: CanvasState, focus: string | null): string {
  return [
    `Canvas "${state.title}" (name: ${state.name}) is open${focus ? `, zoomed to "${focus}"` : ""}.`,
    ...state.items.map(describeItem),
    'If the user is to work in the canvas: call sideview_review. The call waits until the user says or clicks "Done" ("Fertig" in the German UI).',
  ].join("\n");
}

export function describeAnnotation(a: Annotation, items: ImageItem[], index: number): string {
  const item = items.find((i) => i.id === a.itemId);
  const region = item ? regionAt(item.regions, a.rect) : null;
  const canvas = item ? `on the canvas ${fmtRect(onCanvas(item, a.rect), "")}` : null;
  const point = a.rect[2] === 0 && a.rect[3] === 0;
  const spot = point ? `point in the image at x ${a.rect[0]}, y ${a.rect[1]} px` : `in the image ${fmtRect(a.rect)}`;
  const where = [item ? `${item.title} (id ${item.id})` : a.itemId, region ? `region "${region.label}"` : null, spot, canvas && !point ? canvas : null].filter(Boolean).join(", ");
  const done = a.done ? ` – resolved ${a.done.at}${a.done.by === "user" ? " (by the user)" : ""}${a.done.reply ? `, reply: "${a.done.reply}"` : ""}` : "";
  return `${index + 1}. (id ${a.id}) ${where}: ${a.note ? `"${a.note}"` : "(no text)"}${done}`;
}

/** Alle Anmerkungen mit ihrer Nummer auf dem Canvas. `openOnly`: nur offene, erledigte nur gezählt (Ergebnis von „Fertig“). */
export function describeAnnotations(state: Pick<CanvasState, "annotations" | "items">, { openOnly = false } = {}): string {
  if (state.annotations.length === 0) return "No annotations.";
  const numbered = state.annotations.map((a, i) => ({ a, i }));
  const open = numbered.filter(({ a }) => !a.done);
  const done = numbered.length - open.length;
  const shown = openOnly ? open : numbered;
  const head = `${count(open.length, "open annotation", "open annotations")}${done ? `, ${done} resolved` : ""} (rectangles in image pixels, points without area)`;
  if (shown.length === 0) return `${head}.`;
  return [`${head}${openOnly && done ? "; do not implement the resolved ones again" : ""}:`, ...shown.map(({ a, i }) => describeAnnotation(a, state.items, i))].join("\n");
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

/**
 * Ergebnis von sideview_review. Bewusst nur Text: Claude soll zuerst kurz bestätigen, dass es angekommen ist,
 * und erst danach die Ausschnitte holen und gründlich nachdenken. So sieht der Nutzer sofort eine Antwort.
 */
export function describeResult(result: ReviewResult, waitedSeconds?: number): string {
  const waited = waitedSeconds === undefined ? "" : ` after ${formatDuration(waitedSeconds)}`;
  const n = result.annotations.filter((a) => !a.done).length;
  return [
    `The user said "Done"${waited} (canvas ${result.canvas}, ${result.finishedAt}).`,
    describeAnnotations(result, { openOnly: true }),
    n > 0
      ? `Now first write the user one short sentence: that ${n === 1 ? "their annotation has arrived and that you are looking at it" : `their ${n} annotations have arrived and that you are looking at them`}. ` +
        `Then call sideview_get with images: true and only answer in detail once you have the crops. ` +
        `When an annotation is implemented, mark it as resolved with sideview_resolve_annotations, with a short reply. Before you place a revised version: ask whether it replaces the old one or goes next to it.`
      : "There are no open annotations.",
  ].join("\n");
}
