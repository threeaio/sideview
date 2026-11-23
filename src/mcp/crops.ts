// Ausschnitte der markierten Stellen als Bilder für Claude. Etwas Rand drumherum, damit der
// Zusammenhang sichtbar bleibt; höchstens 1200 Pixel an der langen Seite.

import sharp from "sharp";
import type { Annotation, ImageItem, Rect } from "../shared/contracts.ts";
export { regionAt } from "../shared/region-at.ts";

export type Crop = { data: string; mimeType: "image/jpeg"; rect: Rect };

/** Umgebung eines Punkts (Anmerkung ohne Fläche) in Bildpixeln, je Seite. */
export const POINT_CONTEXT = 320;

export function paddedRect([x, y, w, h]: Rect, width: number, height: number, pad = 0.12): Rect {
  const p = w === 0 && h === 0 ? POINT_CONTEXT : Math.round(Math.max(w, h) * pad);
  const left = Math.max(0, x - p);
  const top = Math.max(0, y - p);
  const right = Math.min(width, x + w + p);
  const bottom = Math.min(height, y + h + p);
  return [left, top, Math.max(1, right - left), Math.max(1, bottom - top)];
}

/** Bei einem Punkt: ein Ring um die Stelle im Ausschnitt, damit man sieht, worauf er zeigt. */
function pointMarker([x, y]: Rect, [left, top, width, height]: Rect) {
  const r = Math.max(10, Math.round(Math.min(width, height) * 0.03));
  const cx = x - left;
  const cy = y - top;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1c1c20" stroke-width="${Math.max(4, r / 3)}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fdfdfe" stroke-width="${Math.max(2, r / 6)}"/></svg>`;
  return [{ input: Buffer.from(svg), left: 0, top: 0 }];
}

export async function cropAnnotation(item: ImageItem, annotation: Pick<Annotation, "rect"> & Partial<Annotation>, maxSide = 1200): Promise<Crop> {
  const rect = paddedRect(annotation.rect, item.imageWidth, item.imageHeight);
  const [left, top, width, height] = rect;
  const point = annotation.rect[2] === 0 && annotation.rect[3] === 0;
  // Erst ausschneiden, dann markieren, dann verkleinern: zwei Durchgänge, weil sharp sonst die Reihenfolge selbst wählt.
  const cut = await sharp(item.path, { limitInputPixels: false }).extract({ left, top, width, height }).png().toBuffer();
  const buffer = await sharp(point ? await sharp(cut).composite(pointMarker(annotation.rect, rect)).png().toBuffer() : cut)
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/jpeg", rect };
}

/** Genau dieser Ausschnitt (Bildpixel), ohne Rand, verkleinert auf höchstens `maxSide`. */
export async function cropRect(item: ImageItem, [left, top, width, height]: Rect, maxSide: number): Promise<Omit<Crop, "rect">> {
  const w = Math.min(width, item.imageWidth - left);
  const h = Math.min(height, item.imageHeight - top);
  const buffer = await sharp(item.path, { limitInputPixels: false })
    .extract({ left, top, width: w, height: h })
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
}

/** Ganzes Bild, verkleinert auf höchstens `maxSide` an der langen Seite. */
export async function previewImage(item: ImageItem, maxSide = 1600): Promise<Omit<Crop, "rect">> {
  const buffer = await sharp(item.path, { limitInputPixels: false })
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
}

