// Wo ein Kasten an einem Rechteck hängt (Beschriftung, Notizfeld), in Bildschirmpixeln. Rein, ohne DOM.

import { clamp } from "./camera.ts";

/** Abstand zum Rand des Sichtfensters. */
const MARGIN = 8;
const GAP_LABEL = 6;
const GAP_EDITOR = 8;

export type Attach = "label" | "editor";
export type ScreenRect = { x0: number; y0: number; x1: number; y1: number };
export type Box = { w: number; h: number };

/** Lage (links oben) eines angehängten Kastens in Bildschirmpixeln. Rein, ohne DOM.
 * `top`: oben verdeckter Streifen (schwebende Kopfzeile); Kästen bleiben darunter.
 * `bottom`: unten verdeckter Streifen (Werkzeugleiste); das Notizfeld bleibt darüber. */
export function attachedPosition(attach: Attach, r: ScreenRect, box: Box, view: Box & { top?: number; bottom?: number }): { x: number; y: number } {
  const minY = (view.top ?? 0) + MARGIN;
  if (attach === "editor") {
    const maxY = view.h - (view.bottom ?? 0) - MARGIN;
    const fits = (top: number) => top >= minY && top + box.h <= maxY;
    const below = r.y1 + GAP_EDITOR;
    const above = r.y0 - GAP_EDITOR - box.h;
    const y = fits(below) ? below : fits(above) ? above : clamp(below, minY, Math.max(minY, maxY - box.h));
    return { x: clamp(r.x0 - 1, MARGIN, Math.max(MARGIN, view.w - MARGIN - box.w)), y };
  }
  const natural = { x: r.x0 - 1, y: r.y0 - GAP_LABEL - box.h };
  const visible = r.x1 > 0 && r.x0 < view.w && r.y1 > minY - MARGIN && r.y0 < view.h;
  if (!visible) return natural;
  return {
    x: Math.min(Math.max(natural.x, MARGIN), Math.max(natural.x, r.x1 - box.w)),
    y: Math.min(Math.max(natural.y, minY), r.y1 - box.h),
  };
}

/** Abstand der Karte zur Nummer und zum Rand des Sichtfensters. */
const NOTE_GAP = 4;
const NOTE_MARGIN = 8;

/** Lage der Notizkarte relativ zur Nummer (Bildschirmpixel). Der Reihe nach: rechts daneben, unten bündig mit der
 * Kante des Rahmens (Mitte der Nummer), damit sie nicht in den markierten Bereich hängt; links daneben; unter der Nummer. Genommen wird die erste
 * Lage, die ins Sichtfenster passt und keine Bildmarke (`avoid`) bedeckt, sonst eine davon unter die Marke geschoben. Oben und unten
 * wird die Karte ins Sichtfenster geschoben, nie unter Kopfzeile oder Werkzeugleiste. Rein, ohne DOM. */
export function noteOffset(
  pin: { x: number; y: number; w: number; h: number },
  note: { w: number; h: number },
  view: { w: number; h: number; top?: number; bottom?: number },
  avoid: { x: number; y: number; w: number; h: number }[] = [],
): { x: number; y: number } {
  const minY = (view.top ?? 0) + NOTE_MARGIN;
  const maxY = view.h - (view.bottom ?? 0) - NOTE_MARGIN;
  const intoView = (y: number) => Math.max(minY - pin.y, Math.min(y, maxY - note.h - pin.y));
  // Die Mitte der Nummer sitzt auf der Kante des Rahmens; dort endet die Karte, damit sie nichts Markiertes verdeckt.
  const above = pin.h / 2 - note.h;
  const candidates = [
    { x: pin.w + NOTE_GAP, y: intoView(above) },
    { x: -NOTE_GAP - note.w, y: intoView(above) },
    { x: Math.min(0, view.w - NOTE_MARGIN - note.w - pin.x), y: intoView(pin.h + NOTE_GAP) },
  ];
  const fits = (c: { x: number; y: number }) => pin.x + c.x >= NOTE_MARGIN && pin.x + c.x + note.w <= view.w - NOTE_MARGIN;
  const free = (c: { x: number; y: number }) => {
    const b = { x: pin.x + c.x, y: pin.y + c.y, w: note.w, h: note.h };
    return !avoid.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  };
  const best = candidates.find((c) => fits(c) && free(c));
  if (best) return best;
  // Sonst die erste Lage, die passt, unter die Marken geschoben, solange sie dann noch über der Werkzeugleiste endet.
  for (const c of candidates.filter(fits)) {
    const moved = { ...c };
    for (let n = 0; n < 8 && !free(moved); n++) {
      const b = { x: pin.x + moved.x, y: pin.y + moved.y, w: note.w, h: note.h };
      const o = avoid.find((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h)!;
      moved.y = o.y + o.h + NOTE_GAP - pin.y;
    }
    if (free(moved) && pin.y + moved.y + note.h <= maxY) return moved;
  }
  const first = candidates.find(fits);
  if (first) return first;
  return { x: view.w - NOTE_MARGIN - note.w - pin.x, y: intoView(above) };
}

/**
 * Spread des Abdunkelungs-Schattens um einen Rahmen (Lage und Größe in Bildschirmpixeln), damit er das ganze
 * Sichtfenster deckt: der Abstand von jeder Rahmenkante zum gegenüberliegenden Fensterrand, plus Reserve.
 * Ein fester Wert (100vmax) endete, sobald der Rahmen während einer Fahrt weiter draußen lag (23.11.).
 */
export function scrimSpread(at: { x: number; y: number }, w: number, h: number, view: { w: number; h: number }): number {
  return Math.max(view.w - at.x, at.x + w, view.h - at.y, at.y + h, 0) + 16;
}
