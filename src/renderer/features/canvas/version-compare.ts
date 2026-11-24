// Fassungsvergleich, reiner Kern (23.11.: „nebeneinander, ohne Schieberegler“). Ein ersetztes Bild hat frühere
// Fassungen (älteste zuerst) und die aktuelle. Im Vergleich steht links eine frühere, rechts die aktuelle. Beide
// liegen in derselben Breite auf ihrer eigenen Fläche; dieselbe Kamera zeigt deshalb in beiden dieselbe Stelle,
// von oben gezählt.

import type { Annotation, ImageItem, TileManifest } from "../../../shared/contracts.ts";
import { versionIndexAt } from "../../../shared/versions.ts";
import type { WorldRect } from "./engine/camera.ts";

/** Eine Fassung im Vergleich. `n` zählt ab 1, die älteste zuerst; die aktuelle ist die letzte. */
export type Sheet = {
  n: number;
  total: number;
  current: boolean;
  path: string;
  title: string;
  imageWidth: number;
  imageHeight: number;
  /** Wann sie ersetzt wurde; fehlt bei der aktuellen. */
  replacedAt?: string;
  tiles?: TileManifest;
};

export function sheetsOf(item: ImageItem): Sheet[] {
  const versions = item.versions ?? [];
  const total = versions.length + 1;
  return [
    ...versions.map((v, i) => ({ n: i + 1, total, current: false, path: v.path, title: v.title, imageWidth: v.imageWidth, imageHeight: v.imageHeight, replacedAt: v.replacedAt, tiles: v.tiles })),
    { n: total, total, current: true, path: item.path, title: item.title, imageWidth: item.imageWidth, imageHeight: item.imageHeight, tiles: item.tiles },
  ];
}

/** Lage einer Fassung auf ihrer Fläche: oben links im Ursprung, in der gemeinsamen Breite. */
export function sheetRect(sheet: Pick<Sheet, "imageWidth" | "imageHeight">, width: number): WorldRect {
  return { x: 0, y: 0, w: width, h: (width * sheet.imageHeight) / Math.max(1, sheet.imageWidth) };
}

/** Gemeinsame Breite: die der aktuellen Fassung auf dem Canvas. */
export const compareWidth = (item: ImageItem) => item.imageWidth * item.scale;

/**
 * Zu welcher Fassung eine Anmerkung gehört: zu der, die galt, als sie entstand. Fassung i galt bis zu ihrem
 * `replacedAt`; was danach entstand, gehört zur nächsten. Index in `sheetsOf`.
 */
export const sheetIndexOf = (annotation: Pick<Annotation, "createdAt">, item: ImageItem): number => versionIndexAt(annotation.createdAt, item.versions ?? []);

/** Rechteck einer Anmerkung (Bildpixel ihrer Fassung) auf der Fläche des Vergleichs. */
export function annotationRect(rect: readonly [number, number, number, number], sheet: Pick<Sheet, "imageWidth">, width: number): WorldRect {
  const s = width / Math.max(1, sheet.imageWidth);
  return { x: rect[0] * s, y: rect[1] * s, w: rect[2] * s, h: rect[3] * s };
}

/** Links die frühere Fassung: Vorgabe ist die neueste der früheren, also die direkt vor der aktuellen. */
export const defaultLeft = (item: ImageItem) => Math.max(0, (item.versions?.length ?? 1) - 1);

/** Links eine Fassung weiter (`step` −1 älter, +1 neuer), nur unter den früheren; die aktuelle steht rechts. */
export function stepLeft(left: number, step: number, item: ImageItem): number {
  const last = Math.max(0, (item.versions?.length ?? 1) - 1);
  return Math.min(last, Math.max(0, left + step));
}
