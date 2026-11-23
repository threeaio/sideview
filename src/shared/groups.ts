// Gruppen auf dem Canvas: benannte Fläche hinter mehreren Bildern, etwa eine Figma-Section mit ihren Frames.
// Die Lage folgt aus den Bildern; gespeichert wird nur, welche Bilder dazugehören.

import type { Group, ImageItem } from "./contracts.ts";

/** Rand der Gruppenfläche um ihre Bilder, in Canvas-Einheiten. */
export const GROUP_PAD = 160;
/** Oben derselbe Rand: Die Bildnamen stehen als Marke auf dem Bild, nicht darüber (5.11.: kein leerer Streifen beim Rauszoomen). */
export const GROUP_PAD_TOP = GROUP_PAD;

export type Area = { x: number; y: number; w: number; h: number };

const size = (i: ImageItem) => ({ w: i.imageWidth / i.scale, h: i.imageHeight / i.scale });

/** Fläche um einige Rechtecke: umschließendes Rechteck plus Rand der Gruppe. */
export function areaAround(boxes: Area[]): Area | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0 - GROUP_PAD, y: y0 - GROUP_PAD_TOP, w: x1 - x0 + 2 * GROUP_PAD, h: y1 - y0 + GROUP_PAD + GROUP_PAD_TOP };
}

/** Fläche einer Gruppe: alle ihre Bilder plus Rand. Null, wenn kein Bild mehr dazugehört. */
export function groupArea(group: Group, items: ImageItem[]): Area | null {
  return areaAround(items.filter((i) => group.itemIds.includes(i.id)).map((i) => ({ x: i.x, y: i.y, ...size(i) })));
}

/** Gruppe eines Bildes, falls es in einer liegt. */
export const groupOf = (groups: Group[], itemId: string) => groups.find((g) => g.itemIds.includes(itemId)) ?? null;
