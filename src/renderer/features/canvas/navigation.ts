// Anfahren von Bildern und Bereichen. Dieselben Fahrten für Sprache und Inhaltsverzeichnis.

import type { Annotation, Group, ImageItem, Region } from "../../../shared/contracts.ts";
export { readingOrder } from "./reading-order.ts";
import { groupArea } from "../../../shared/groups.ts";
import type { Engine } from "./engine/engine.ts";
import { sameView, type WorldRect } from "./engine/camera.ts";
import { imageToWorld, itemWorldRect } from "./engine/geometry.ts";

/** Das ganze Bild, höchstens in Originalgröße. */
export const showItem = (engine: Engine, item: ImageItem) => void engine.fit(itemWorldRect(item), WHOLE);
const WHOLE = { padding: 64, maxZoom: 1 };
const WIDTH = { padding: 64, maxZoom: 1, top: true };

/** Ab hier gilt ein Bild als lange Seite: ganz gezeigt ist es mehr als viermal kleiner als in voller Breite. */
const LONG = 4;

/**
 * Doppelklick auf ein Bild (6.11.), zwei Ansichten im Wechsel: ganz und volle Breite vom Anfang an, höchstens
 * in Originalgröße. Normale Bilder zuerst ganz; lange Seiten zuerst in voller Breite, weil sie ganz gezeigt nur ein
 * schmaler Streifen sind. Der nächste Doppelklick wechselt zur anderen Ansicht.
 */
export function toggleItem(engine: Engine, item: ImageItem) {
  const rect = itemWorldRect(item);
  const whole = engine.fitTarget(rect, WHOLE);
  const width = engine.fitTarget(rect, WIDTH);
  const cam = engine.camera();
  if (sameView(whole, width)) return void engine.fit(rect, WHOLE);
  const long = whole.z * LONG < width.z;
  const [first, second] = long ? [WIDTH, WHOLE] : [WHOLE, WIDTH];
  const atFirst = sameView(cam, long ? width : whole);
  void engine.fit(rect, atFirst ? second : first);
}

/** Erste Ansicht eines Bildes wie beim Doppelklick: normale Bilder ganz, lange Seiten in voller Breite vom Anfang an. */
export function focusItem(engine: Engine, item: ImageItem) {
  const rect = itemWorldRect(item);
  const long = engine.fitTarget(rect, WHOLE).z * LONG < engine.fitTarget(rect, WIDTH).z;
  void engine.fit(rect, long ? WIDTH : WHOLE);
}

/**
 * Das Bild, das gerade im Blick ist: das unter der Mitte des Fensters, sonst das nächste. In der Übersicht, wenn alle
 * Bilder ganz zu sehen sind, keines.
 */
export function itemInView(engine: Engine, items: ImageItem[]): string | null {
  const cam = engine.camera();
  const vp = engine.viewport();
  const view = { x0: cam.x, y0: cam.y, x1: cam.x + vp.w / cam.z, y1: cam.y + vp.h / cam.z };
  const rects = items.map((item) => ({ id: item.id, r: itemWorldRect(item) }));
  if (rects.length === 0) return null;
  const allVisible = rects.every(({ r }) => r.x >= view.x0 && r.y >= view.y0 && r.x + r.w <= view.x1 && r.y + r.h <= view.y1);
  if (allVisible) return null;
  const c = { x: (view.x0 + view.x1) / 2, y: (view.y0 + view.y1) / 2 };
  const distance = ({ r }: { r: WorldRect }) => Math.hypot(Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), Math.max(r.y - c.y, 0, c.y - (r.y + r.h)));
  return rects.sort((a, b) => distance(a) - distance(b))[0]?.id ?? null;
}

/** Ein Bereich wie „Kopf“, nah genug zum Lesen. */
export const showRegion = (engine: Engine, item: ImageItem, region: Region) => void engine.fit(imageToWorld(item, region.rect), { padding: 48, maxZoom: 2 });

/** Eine Gruppe ganz, mit ihrem Namen. */
export const showGroup = (engine: Engine, group: Group, items: ImageItem[]) => {
  const area = groupArea(group, items);
  if (area) void engine.fit(area, { padding: 64, maxZoom: 1 });
};

/** Eine Anmerkung mit etwas Umgebung, nah genug zum Lesen. `insetRight`: Platz einer offenen Liste rechts. */
export const showAnnotation = (engine: Engine, item: ImageItem, a: Annotation, insetRight = 0) =>
  void engine.fit(imageToWorld(item, a.rect), { padding: 96, maxZoom: 4, insetRight });

/** Mehrere Bilder zusammen, etwa die gerade von einer Erweiterung gelegten. */
export function showItems(engine: Engine, items: ImageItem[], ids: string[]) {
  const rects = items.filter((i) => ids.includes(i.id)).map(itemWorldRect);
  if (rects.length === 0) return;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x;
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y;
  void engine.fit({ x, y, w, h }, { padding: 96, maxZoom: 1 });
}

/** „desktop.png“ → „desktop“. */
export const imageName = (title: string) => title.replace(/\.(png|jpe?g|webp)$/i, "");
