// Anordnung ohne Überlappung: Gruppen sind Reihen (Bilder nebeneinander, oben bündig, fester Abstand, wie
// Auto-Layout), und was abgelegt wird, rückt aus allem anderen heraus (5.11.: „Ich denke nicht, dass ich
// Dinge wirklich übereinander überlappend haben möchte“). Reine Rechnung, für Hauptprozess und Oberfläche.

import type { Group, ImageItem } from "./contracts.ts";
import { groupArea } from "./groups.ts";

/** Abstand zwischen Bildern in einer Gruppe und zwischen allem, was frei liegt. */
export const LAYOUT_GAP = 200;
/** Abstand einer Gruppenfläche zu allem anderen: Platz für den Namen der Gruppe darüber. */
export const GROUP_GAP = 360;

export type Box = { x: number; y: number; w: number; h: number };
export type Position = { id: string; x: number; y: number };

export const itemBox = (i: ImageItem): Box => ({ x: i.x, y: i.y, w: i.imageWidth / i.scale, h: i.imageHeight / i.scale });

/**
 * Größte Breite einer Gruppe, ohne Rand, solange der Nutzer keine eigene gezogen hat: etwa fünf Desktop-Screenshots
 * nebeneinander (20.11.: „schon im Default sollten die eine Maxbreite haben“).
 */
export const DEFAULT_GROUP_WIDTH = 8000;

/** Breite, bis zu der eine Gruppe ihre Bilder nebeneinander legt: gezogen oder Vorgabe. */
export const groupWidth = (g: Pick<Group, "maxWidth">): number => g.maxWidth ?? DEFAULT_GROUP_WIDTH;

/**
 * Reihe einer Gruppe ab dem Ursprung `origin` (links oben des ersten Bildes): Bilder in `order` nebeneinander, oben
 * bündig, fester Abstand. Passt das nächste Bild nicht mehr in die Breite `width`, beginnt darunter eine neue Zeile
 * (wie Text). Jede Zeile hat mindestens ein Bild, auch wenn es breiter ist.
 * `slot`: Platzhalter dieser Größe an Stelle `slot.index`, etwa für ein Bild, das gerade hineingezogen wird.
 */
export function rowPositions(
  order: ImageItem[],
  origin: { x: number; y: number },
  width: number,
  slot?: { index: number; w: number; h: number },
): { positions: Position[]; slot: { x: number; y: number } | null } {
  const entries: { id: string | null; w: number; h: number }[] = order.map((item) => ({ id: item.id, ...itemBox(item) }));
  if (slot) entries.splice(Math.min(slot.index, entries.length), 0, { id: null, w: slot.w, h: slot.h });
  const positions: Position[] = [];
  let slotAt: { x: number; y: number } | null = null;
  let x = origin.x;
  let y = origin.y;
  let lineH = 0;
  for (const e of entries) {
    if (x > origin.x && x + e.w > origin.x + width) {
      x = origin.x;
      y += lineH + LAYOUT_GAP;
      lineH = 0;
    }
    if (e.id === null) slotAt = { x, y };
    else positions.push({ id: e.id, x, y });
    x += e.w + LAYOUT_GAP;
    lineH = Math.max(lineH, e.h);
  }
  return { positions, slot: slotAt };
}

/** Ursprung einer Gruppe: links oben über alle ihre Bilder. */
export function groupOrigin(group: Group, items: ImageItem[]): { x: number; y: number } | null {
  const members = items.filter((i) => group.itemIds.includes(i.id));
  if (!members.length) return null;
  return { x: Math.min(...members.map((i) => i.x)), y: Math.min(...members.map((i) => i.y)) };
}

/**
 * Stelle in einer Gruppe, an der ein Bild landet, wenn der Zeiger bei `p` steht: in der Zeile, auf deren Höhe er
 * steht (unter der letzten: die letzte), vor dem ersten Bild, dessen Mitte rechts von ihm liegt.
 */
export function insertIndex(order: ImageItem[], p: { x: number; y: number }): number {
  if (!order.length) return 0;
  const tops = [...new Set(order.map((i) => i.y))].sort((a, b) => a - b);
  const top = [...tops].reverse().find((t) => p.y >= t - LAYOUT_GAP / 2) ?? tops[0]!;
  const line = order.map((item, i) => ({ item, i })).filter((e) => e.item.y === top);
  const hit = line.find((e) => p.x < e.item.x + itemBox(e.item).w / 2);
  return hit ? hit.i : line[line.length - 1]!.i + 1;
}

const overlaps = (a: Box, b: Box, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Lage für `box`, an der es nichts aus `others` überdeckt (mit Abstand `gap`): Liegt es frei, bleibt es; sonst
 * der kürzeste Weg nach rechts, links, unten oder oben aus dem Weg, so oft wie nötig.
 */
export function freeSpot(box: Box, others: Box[], gap = LAYOUT_GAP): { x: number; y: number } {
  let b = { ...box };
  for (let round = 0; round < 50; round++) {
    const hit = others.find((o) => overlaps(b, o, gap));
    if (!hit) return { x: b.x, y: b.y };
    const moves = [
      { x: hit.x + hit.w + gap - b.x, y: 0 },
      { x: hit.x - gap - b.w - b.x, y: 0 },
      { x: 0, y: hit.y + hit.h + gap - b.y },
      { x: 0, y: hit.y - gap - b.h - b.y },
    ];
    // Kürzester Weg, der nicht gleich in ein anderes Hindernis führt; sonst einfach der kürzeste.
    moves.sort((m, n) => Math.hypot(m.x, m.y) - Math.hypot(n.x, n.y));
    const clear = moves.find((m) => !others.some((o) => overlaps({ ...b, x: b.x + m.x, y: b.y + m.y }, o, gap)));
    const m = clear ?? moves[0]!;
    b = { ...b, x: b.x + m.x, y: b.y + m.y };
  }
  return { x: b.x, y: b.y };
}

/**
 * Was frei auf der Fläche liegt, als Blöcke: jede Gruppe mit ihrer Fläche, jedes Bild ohne Gruppe für sich.
 * `key` ist die id der Gruppe oder des Bildes.
 */
type Block = { key: string; ids: string[]; box: Box; gap: number };
function blocksOf(items: ImageItem[], groups: Group[]): Block[] {
  const grouped = new Set(groups.flatMap((g) => g.itemIds));
  return [
    ...groups.flatMap((g) => {
      const box = groupArea(g, items);
      return box ? [{ key: g.id, ids: g.itemIds, box, gap: GROUP_GAP }] : [];
    }),
    ...items.filter((i) => !grouped.has(i.id)).map((i) => ({ key: i.id, ids: [i.id], box: itemBox(i), gap: LAYOUT_GAP })),
  ];
}
const shift = (items: ImageItem[], ids: string[], dx: number, dy: number) => {
  const moving = new Set(ids);
  return dx === 0 && dy === 0 ? items : items.map((i) => (moving.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i));
};

/** Ein Block (Gruppe oder freies Bild) rückt aus allem anderen heraus, wie beim Ablegen. */
export function clearOf(items: ImageItem[], groups: Group[], key: string): ImageItem[] {
  const all = blocksOf(items, groups);
  const me = all.find((b) => b.key === key);
  if (!me) return items;
  const spot = freeSpot(me.box, all.filter((b) => b !== me).map((b) => b.box), me.gap);
  return shift(items, me.ids, spot.x - me.box.x, spot.y - me.box.y);
}

/**
 * Platz machen: Die Blöcke in `stay` (eben gewachsen, abgelegt, getauscht) bleiben, wo sie sind. Was sie überdeckt,
 * rückt auf kürzestem Weg aus dem Weg, und so weiter, falls das wieder etwas überdeckt. Alles andere bleibt liegen
 * (9.11.: Gruppen verschoben sich „randomly“, Dinge lagen übereinander).
 */
export function makeRoom(items: ImageItem[], groups: Group[], stay: string[]): ImageItem[] {
  const settled = new Set(stay);
  for (let round = 0; round < 100; round++) {
    const all = blocksOf(items, groups);
    const fixed = all.filter((b) => settled.has(b.key));
    const hit = all.find((b) => !settled.has(b.key) && fixed.some((f) => overlaps(b.box, f.box, b.gap)));
    if (!hit) return items;
    const spot = freeSpot(hit.box, all.filter((b) => b !== hit).map((b) => b.box), hit.gap);
    items = shift(items, hit.ids, spot.x - hit.box.x, spot.y - hit.box.y);
    settled.add(hit.key);
  }
  return items;
}

/**
 * Was an einer Anordnung nicht stimmt: Blöcke, die sich überdecken, und Gruppen, die keine Reihe sind. Leer, wenn
 * alles stimmt. Für Tests.
 */
export function layoutProblems(items: ImageItem[], groups: Group[]): string[] {
  const out: string[] = [];
  const all = blocksOf(items, groups);
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) if (overlaps(all[a]!.box, all[b]!.box, 0)) out.push(`überlappt: ${all[a]!.key} / ${all[b]!.key}`);
  for (const g of groups) {
    const m = g.itemIds.flatMap((id) => items.find((i) => i.id === id) ?? []);
    if (!m.length) continue;
    const want = rowPositions(m, { x: m[0]!.x, y: m[0]!.y }, groupWidth(g)).positions;
    if (want.some((p, k) => Math.abs(p.x - m[k]!.x) > 0.5 || Math.abs(p.y - m[k]!.y) > 0.5)) out.push(`keine Reihe: ${g.title}`);
  }
  return out;
}
