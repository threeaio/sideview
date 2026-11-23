// Umrechnung zwischen Bildpixeln (Anmerkungen, Bereiche) und Welteinheiten der Fläche. Rein, ohne DOM.

import type { Group, ImageItem, Rect, Region } from "../../../../shared/contracts.ts";
import { groupArea } from "../../../../shared/groups.ts";
import type { Point, WorldRect } from "./camera.ts";

export const itemWorldRect = (item: ImageItem): WorldRect => ({
  x: item.x,
  y: item.y,
  w: item.imageWidth / item.scale,
  h: item.imageHeight / item.scale,
});

export const imageToWorld = (item: ImageItem, [x, y, w, h]: Rect): WorldRect => ({
  x: item.x + x / item.scale,
  y: item.y + y / item.scale,
  w: w / item.scale,
  h: h / item.scale,
});

/** Weltrechteck in Bildpixel, auf das Bild begrenzt und gerundet. */
export function worldToImage(item: ImageItem, r: WorldRect): Rect {
  const x0 = Math.max(0, Math.min(item.imageWidth, Math.round((Math.min(r.x, r.x + r.w) - item.x) * item.scale)));
  const y0 = Math.max(0, Math.min(item.imageHeight, Math.round((Math.min(r.y, r.y + r.h) - item.y) * item.scale)));
  const x1 = Math.max(0, Math.min(item.imageWidth, Math.round((Math.max(r.x, r.x + r.w) - item.x) * item.scale)));
  const y1 = Math.max(0, Math.min(item.imageHeight, Math.round((Math.max(r.y, r.y + r.h) - item.y) * item.scale)));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Rechteck aus zwei Punkten, egal in welche Richtung gezogen. */
export function rectFromPoints(a: Point, b: Point): WorldRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function contains(r: WorldRect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Oberstes Bild unter dem Punkt. */
export function itemAt(items: ImageItem[], p: Point): ImageItem | null {
  for (let i = items.length - 1; i >= 0; i--) if (contains(itemWorldRect(items[i]!), p)) return items[i]!;
  return null;
}

/** Alles auf dem Canvas: Bilder und die Flächen ihrer Gruppen (samt Rand, sonst fehlt der Gruppenname). */
export function contentBounds(items: ImageItem[], groups: Group[] = []): WorldRect | null {
  if (items.length === 0) return null;
  const rects = [...items.map(itemWorldRect), ...groups.flatMap((g) => groupArea(g, items) ?? [])];
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Bereich eines Bildes nach Name oder Kürzel, ohne Groß- und Kleinschreibung. */
export function findRegion(items: ImageItem[], name: string): { item: ImageItem; region: Region } | null {
  const wanted = name.trim().toLowerCase();
  for (const item of items) {
    const region = item.regions.find((r) => r.label.toLowerCase() === wanted || r.aliases.some((a) => a.toLowerCase() === wanted));
    if (region) return { item, region };
  }
  return null;
}

/** Das Bild, das das Rechteck am meisten überdeckt; null, wenn es keines berührt. */
export function largestOverlap<T extends ImageItem>(items: T[], r: WorldRect): T | null {
  let best: T | null = null;
  let bestArea = 0;
  for (const item of items) {
    const ir = itemWorldRect(item);
    const w = Math.min(r.x + r.w, ir.x + ir.w) - Math.max(r.x, ir.x);
    const h = Math.min(r.y + r.h, ir.y + ir.h) - Math.max(r.y, ir.y);
    if (w > 0 && h > 0 && w * h > bestArea) {
      bestArea = w * h;
      best = item;
    }
  }
  return best;
}
