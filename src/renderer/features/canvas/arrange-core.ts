// Anordnen, reiner Kern: was unter dem Zeiger liegt, was ein Auswahlrechteck trifft, und was beim Ziehen passiert.
// Gruppen sind Reihen (shared/layout.ts). Beim Ziehen entscheidet der Zeiger: Steht er über einer Gruppe, rücken
// deren Bilder auseinander und lassen eine Lücke, wo das Bild landet; sonst schließt sich die Reihe, aus der es
// kommt. Beim Loslassen rückt, was frei liegt, aus allem anderen heraus (5.11.: „man sieht nie vorher, ob
// er drin bleibt oder nicht“, „nicht übereinander überlappend“).

import { t } from "../../../shared/i18n/index.ts";
import type { Language } from "../../../shared/settings.ts";
import type { CanvasState, Group, ImageItem, Layout } from "../../../shared/contracts.ts";
import { GROUP_PAD, areaAround, groupArea, type Area } from "../../../shared/groups.ts";
import { GROUP_GAP, LAYOUT_GAP, freeSpot, groupOrigin, groupWidth, insertIndex, itemBox, makeRoom, rowPositions, type Box } from "../../../shared/layout.ts";
import type { Point, WorldRect } from "./engine/camera.ts";
import { contains, itemWorldRect } from "./engine/geometry.ts";

/** `edge`: der rechte Rand einer Gruppe, an dem man ihre Breite zieht. */
export type ArrangeHit = { kind: "item"; id: string } | { kind: "group"; id: string } | { kind: "edge"; id: string };
export type Selection = { kind: "items"; ids: string[] } | { kind: "group"; id: string } | null;

/** Ziehen: bewegte Bilder, ganze Gruppe oder nicht, Versatz und Zeiger in Welteinheiten. */
export type Drag = { ids: string[]; group: string | null; dx: number; dy: number; pointer: Point };

/** Was beim Ziehen zu sehen ist: Stand mit Vorschau, Zielgruppe mit Einfügestelle, Flächen und Lücke. */
export type DragPreview = {
  view: CanvasState;
  target: { groupId: string; index: number } | null;
  /** Flächen, die von der Rechnung aus den Bildern abweichen: die Zielgruppe samt Lücke. */
  areas: Record<string, Area>;
  slot: Box | null;
};

/** Höhe der Zeile mit dem Gruppennamen über der Fläche, in Bildschirmpixeln; der Name ist anklickbar. */
const LABEL_PX = 32;
/** Breite eines Zeichens im Gruppennamen, grob, in Bildschirmpixeln. */
const CHAR_PX = 9;

/** Halbe Breite des Griffs am rechten Rand einer Gruppe, in Bildschirmpixeln. */
const EDGE_PX = 10;

/** Rechter Rand einer Gruppe unter dem Punkt, sonst das oberste Bild, sonst eine Gruppe (Fläche oder Name darüber), sonst nichts. */
export function hitArrange(state: CanvasState, p: Point, zoom: number): ArrangeHit | null {
  for (const g of [...state.groups].reverse()) {
    const area = groupArea(g, state.items);
    if (area && Math.abs(p.x - (area.x + area.w)) <= EDGE_PX / zoom && p.y >= area.y && p.y <= area.y + area.h) return { kind: "edge", id: g.id };
  }
  for (let i = state.items.length - 1; i >= 0; i--) if (contains(itemWorldRect(state.items[i]!), p)) return { kind: "item", id: state.items[i]!.id };
  for (const g of [...state.groups].reverse()) {
    const area = groupArea(g, state.items);
    if (!area) continue;
    const label = { x: area.x, y: area.y - LABEL_PX / zoom, w: Math.min(area.w, ((g.title.length + 2) * CHAR_PX) / zoom), h: LABEL_PX / zoom };
    if (contains(area, p) || contains(label, p)) return { kind: "group", id: g.id };
  }
  return null;
}

const overlaps = (a: WorldRect, b: WorldRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Bilder, die das Auswahlrechteck berührt. */
export const itemsInRect = (items: ImageItem[], r: WorldRect) => items.filter((i) => overlaps(itemWorldRect(i), r)).map((i) => i.id);

/** Welche Bilder eine Auswahl bewegt: die gewählten Bilder oder alle Bilder der Gruppe. */
export function selectedItemIds(state: CanvasState, selection: Selection): string[] {
  if (!selection) return [];
  if (selection.kind === "items") return selection.ids.filter((id) => state.items.some((i) => i.id === id));
  return state.groups.find((g) => g.id === selection.id)?.itemIds ?? [];
}

/** Stand mit verschobenen Bildern. Gruppenflächen und Anmerkungen wandern mit. */
export function withOffset(state: CanvasState, ids: string[], dx: number, dy: number): CanvasState {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return state;
  const moving = new Set(ids);
  return { ...state, items: state.items.map((i) => (moving.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)) };
}

const place = (items: ImageItem[], positions: { id: string; x: number; y: number }[]) => {
  const at = new Map(positions.map((p) => [p.id, p]));
  return items.map((i) => (at.has(i.id) ? { ...i, x: at.get(i.id)!.x, y: at.get(i.id)!.y } : i));
};
const membersOf = (g: Group, items: ImageItem[]) => g.itemIds.flatMap((id) => items.find((i) => i.id === id) ?? []);

/** Vorschau beim Ziehen (siehe Kopf der Datei). */
export function previewDrag(state: CanvasState, drag: Drag): DragPreview {
  if (drag.group) return { view: onTop(withOffset(state, drag.ids, drag.dx, drag.dy), drag.ids), target: null, areas: {}, slot: null };
  const moving = new Set(drag.ids);
  const moved = withOffset(state, drag.ids, drag.dx, drag.dy).items;
  // Gruppen, aus denen die gezogenen Bilder kommen, als Reihe ab ihrem bisherigen Ursprung: Die Reihe schließt sich.
  // Alle anderen bleiben, wie sie sind.
  const origins = new Map(state.groups.map((g) => [g.id, groupOrigin(g, state.items)]));
  const sources = new Set(state.groups.filter((g) => g.itemIds.some((id) => moving.has(id))).map((g) => g.id));
  const groups = state.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter((id) => !moving.has(id)) }));
  let items = moved;
  for (const g of groups) {
    const origin = origins.get(g.id);
    if (origin && sources.has(g.id)) items = place(items, rowPositions(membersOf(g, items), origin, groupWidth(g)).positions);
  }
  // Ziel: die Gruppe unter dem Zeiger. Eine Gruppe, die ohne die gezogenen Bilder leer wäre, zählt mit ihrer alten Fläche.
  const target = groups.find((g) => {
    const area = g.itemIds.length ? groupArea(g, items) : groupArea(state.groups.find((x) => x.id === g.id)!, state.items);
    return area !== null && contains(area, drag.pointer);
  });
  if (!target) return { view: onTop({ ...state, items, groups }, drag.ids), target: null, areas: {}, slot: null };

  const draggedBoxes = state.items.filter((i) => moving.has(i.id)).sort((a, b) => a.x - b.x).map(itemBox);
  const slotW = draggedBoxes.reduce((w, b) => w + b.w, 0) + LAYOUT_GAP * (draggedBoxes.length - 1);
  const slotH = Math.max(...draggedBoxes.map((b) => b.h));
  const members = membersOf(target, items);
  const index = insertIndex(members, drag.pointer);
  const origin = origins.get(target.id)!;
  const row = rowPositions(members, origin, groupWidth(target), { index, w: slotW, h: slotH });
  items = place(items, row.positions);
  const slot = { ...(row.slot ?? origin), w: slotW, h: slotH };
  const area = areaAround([...membersOf(target, items).map(itemBox), slot])!;
  return { view: onTop({ ...state, items, groups }, drag.ids), target: { groupId: target.id, index }, areas: { [target.id]: area }, slot };
}

/** Gezogene Bilder zuletzt, also oben: Motor und HTML-Ebene zeichnen in dieser Reihenfolge. */
function onTop(state: CanvasState, ids: string[]): CanvasState {
  const moving = new Set(ids);
  return { ...state, items: [...state.items.filter((i) => !moving.has(i.id)), ...state.items.filter((i) => moving.has(i.id))] };
}

/** Bilder, die ein gezogenes Bild gerade überdeckt: Ihre Schatten, Titel und Rahmen gehören darunter, nicht darüber. */
export function coveredBy(state: CanvasState, ids: string[]): Set<string> {
  const moving = state.items.filter((i) => ids.includes(i.id)).map(itemWorldRect);
  return new Set(state.items.filter((i) => !ids.includes(i.id) && moving.some((m) => overlaps(m, itemWorldRect(i)))).map((i) => i.id));
}

/** Anordnung nach dem Loslassen: in die Lücke der Zielgruppe, sonst frei und ohne Überlappung. */
export function dropLayout(state: CanvasState, drag: Drag): Layout {
  const preview = previewDrag(state, drag);
  let items = preview.view.items;
  let groups = preview.view.groups;
  const moving = new Set(drag.ids);
  const grouped = (id: string) => groups.some((g) => g.itemIds.includes(id));

  if (drag.group) {
    // Ganze Gruppe: als Block aus allem anderen heraus.
    const g = groups.find((x) => x.id === drag.group)!;
    const area = groupArea(g, items)!;
    const others = [...items.filter((i) => !moving.has(i.id) && !grouped(i.id)).map(itemBox), ...groups.filter((x) => x.id !== g.id).flatMap((x) => groupArea(x, items) ?? [])];
    const spot = freeSpot(area, others, GROUP_GAP);
    items = place(items, items.filter((i) => moving.has(i.id)).map((i) => ({ id: i.id, x: i.x + spot.x - area.x, y: i.y + spot.y - area.y })));
  } else if (preview.target && preview.slot) {
    // In die Lücke, in der bisherigen Reihenfolge der gezogenen Bilder.
    const dragged = state.items.filter((i) => moving.has(i.id)).sort((a, b) => a.x - b.x);
    groups = groups.map((g) => {
      if (g.id !== preview.target!.groupId) return g;
      const itemIds = [...g.itemIds];
      itemIds.splice(preview.target!.index, 0, ...dragged.map((d) => d.id));
      return { ...g, itemIds };
    });
    const target = groups.find((g) => g.id === preview.target!.groupId)!;
    // Ab dem alten Ursprung der Gruppe; der gilt auch, wenn die Lücke ganz vorn oder in einer anderen Zeile lag.
    const origin = groupOrigin(state.groups.find((g) => g.id === target.id)!, state.items)!;
    items = place(items, rowPositions(membersOf(target, items), origin, groupWidth(target)).positions);
    // Die Gruppe ist breiter geworden: Was sie jetzt überdeckt, rückt zur Seite.
    items = makeRoom(items, groups, [target.id]);
  } else {
    // Frei abgelegt: jedes gezogene Bild aus allem anderen heraus, eins nach dem anderen.
    const fixed = () => [...items.filter((i) => !moving.has(i.id) && !grouped(i.id)).map(itemBox), ...groups.flatMap((g) => groupArea(g, items) ?? [])];
    const placed: Box[] = [];
    for (const i of items.filter((x) => moving.has(x.id))) {
      const spot = freeSpot(itemBox(i), [...fixed(), ...placed]);
      items = place(items, [{ id: i.id, ...spot }]);
      placed.push({ ...itemBox(i), ...spot });
    }
  }
  return { items: items.map((i) => ({ id: i.id, x: i.x, y: i.y })), groups: groups.filter((g) => g.itemIds.length > 0) };
}

/** Anordnung des Stands, wie er ist: für Rückgängig. */
export const layoutOf = (state: CanvasState): Layout => ({ items: state.items.map((i) => ({ id: i.id, x: i.x, y: i.y })), groups: state.groups.map((g) => ({ ...g, itemIds: [...g.itemIds] })) });

/** Gruppen, die Bilder verloren haben, als geschlossene Reihen; alle anderen bleiben, wie sie sind. */
export function reflowAfterRemove(state: CanvasState, removed: string[]): Layout {
  const gone = new Set(removed);
  const rest = state.items.filter((i) => !gone.has(i.id));
  let items = rest;
  const touched = new Set(state.groups.filter((g) => g.itemIds.some((id) => gone.has(id))).map((g) => g.id));
  const groups = state.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter((id) => !gone.has(id)) })).filter((g) => g.itemIds.length > 0);
  for (const g of groups.filter((x) => touched.has(x.id))) {
    const origin = groupOrigin(state.groups.find((x) => x.id === g.id)!, state.items);
    if (origin) items = place(items, rowPositions(membersOf(g, items), origin, groupWidth(g)).positions);
  }
  return { items: items.map((i) => ({ id: i.id, x: i.x, y: i.y })), groups };
}

/**
 * Breite einer Gruppe, wenn ihr rechter Rand bei `px` steht: Inhalt ohne Rand, mindestens ihr breitestes Bild.
 */
export function widthAt(state: CanvasState, groupId: string, px: number): number | null {
  const g = state.groups.find((x) => x.id === groupId);
  const origin = g && groupOrigin(g, state.items);
  if (!g || !origin) return null;
  const widest = Math.max(...membersOf(g, state.items).map((i) => itemBox(i).w));
  return Math.round(Math.max(widest, px - GROUP_PAD - origin.x));
}

/** Gruppe mit neuer Breite: Ihre Reihe bricht neu um, ab ihrem Ursprung. Für die Vorschau beim Ziehen am Rand. */
export function previewResize(state: CanvasState, groupId: string, maxWidth: number): CanvasState {
  const g = state.groups.find((x) => x.id === groupId);
  const origin = g && groupOrigin(g, state.items);
  if (!g || !origin) return state;
  const groups = state.groups.map((x) => (x.id === groupId ? { ...x, maxWidth } : x));
  return { ...state, groups, items: place(state.items, rowPositions(membersOf(g, state.items), origin, maxWidth).positions) };
}

/** Nach dem Ziehen am Rand: neue Breite, Reihe neu umgebrochen, was die Gruppe jetzt überdeckt, rückt zur Seite. */
export function resizeLayout(state: CanvasState, groupId: string, maxWidth: number): Layout {
  const view = previewResize(state, groupId, maxWidth);
  const items = makeRoom(view.items, view.groups, [groupId]);
  return { items: items.map((i) => ({ id: i.id, x: i.x, y: i.y })), groups: view.groups };
}

/** Freier Name für eine neue Gruppe: „Gruppe 1“, „Gruppe 2“ … */
export function nextGroupTitle(groups: Group[], lang: Language = "de"): string {
  const taken = new Set(groups.map((g) => g.title.toLowerCase()));
  for (let n = 1; ; n++) {
    const title = t(lang, "canvas.defaultGroup", { n });
    if (!taken.has(title.toLowerCase())) return title;
  }
}

/**
 * Gewählte Bilder zu einer neuen Gruppe: Reihe nach ihrer Lage von links nach rechts, ab dem Bild links oben.
 * Sie verlassen ihre alten Gruppen (die schließen sich), und die neue Gruppe rückt aus allem anderen heraus.
 */
export function groupLayout(state: CanvasState, ids: string[], group: { id: string; title: string }): Layout {
  const chosen = new Set(ids);
  const members = state.items.filter((i) => chosen.has(i.id)).sort((a, b) => a.x - b.x || a.y - b.y);
  const before = reflowAfterRemove(state, ids);
  let items = place(state.items, before.items);
  const origin = { x: Math.min(...members.map((i) => i.x)), y: Math.min(...members.map((i) => i.y)) };
  items = place(items, rowPositions(members, origin, groupWidth({})).positions);
  const created: Group = { ...group, itemIds: members.map((i) => i.id) };
  const groups = [...before.groups, created];
  const grouped = (id: string) => groups.some((g) => g.itemIds.includes(id));
  const area = groupArea(created, items)!;
  const others = [...items.filter((i) => !grouped(i.id)).map(itemBox), ...before.groups.flatMap((g) => groupArea(g, items) ?? [])];
  const spot = freeSpot(area, others, GROUP_GAP);
  items = place(items, members.map((m) => {
    const now = items.find((i) => i.id === m.id)!;
    return { id: m.id, x: now.x + spot.x - area.x, y: now.y + spot.y - area.y };
  }));
  return { items: items.map((i) => ({ id: i.id, x: i.x, y: i.y })), groups };
}
