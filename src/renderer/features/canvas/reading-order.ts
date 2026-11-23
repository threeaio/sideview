// Rein, ohne DOM: in welcher Reihenfolge man die Bilder durchblättert.

import type { CanvasState, ImageItem } from "../../../shared/contracts.ts";

/**
 * Reihenfolge zum Durchblättern: Bilder in ihrer Reihenfolge, eine Gruppe dort, wo ihr erstes Bild steht, mit allen
 * ihren Bildern hintereinander, so wie sie in der Reihe liegen (links nach rechts, Zeile für Zeile).
 */
export function readingOrder(state: Pick<CanvasState, "items" | "groups">): ImageItem[] {
  const out: ImageItem[] = [];
  const listed = new Set<string>();
  for (const item of state.items) {
    if (listed.has(item.id)) continue;
    const group = state.groups.find((g) => g.itemIds.includes(item.id));
    const members = group ? group.itemIds.flatMap((id) => state.items.find((x) => x.id === id) ?? []) : [item];
    for (const m of members) {
      listed.add(m.id);
      out.push(m);
    }
  }
  return out;
}

