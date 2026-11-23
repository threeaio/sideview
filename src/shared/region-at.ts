// Bereich eines Bildes, in dem ein Rechteck sitzt. Für Claude (Beschreibung) und die Oberfläche (Liste der Anmerkungen).

import type { Rect, Region } from "./contracts.ts";

/** Bereich, in dem die Mitte des Rechtecks liegt, etwa „Kopf“. */
export function regionAt(regions: Region[], [x, y, w, h]: Rect): Region | null {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return regions.find(({ rect: [rx, ry, rw, rh] }) => cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh) ?? null;
}
