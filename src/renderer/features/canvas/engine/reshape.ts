// Rahmen nachträglich ändern: an Ecken und Kanten ziehen ändert die Größe, der Griff verschiebt.
// Rein, ohne DOM. Der Rahmen bleibt im Bild und wird nie kleiner als `min`.

import { clamp, type WorldRect } from "./camera.ts";

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/** Neuer Rahmen, wenn `handle` um dx, dy (Welteinheiten) gezogen wurde. `bounds` ist das Bild. */
export function reshapeRect(start: WorldRect, handle: Handle, dx: number, dy: number, bounds: WorldRect, min: number): WorldRect {
  const bx1 = bounds.x + bounds.w;
  const by1 = bounds.y + bounds.h;
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, bounds.x, bx1 - start.w), y: clamp(start.y + dy, bounds.y, by1 - start.h) };
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (handle.includes("w")) x0 = clamp(x0 + dx, bounds.x, x1 - min);
  if (handle.includes("e")) x1 = clamp(x1 + dx, x0 + min, bx1);
  if (handle.includes("n")) y0 = clamp(y0 + dy, bounds.y, y1 - min);
  if (handle.includes("s")) y1 = clamp(y1 + dy, y0 + min, by1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
