// Zufallsläufe über die Anordnung: Ziehen (frei, in Gruppen), Gruppe ziehen, löschen, gruppieren. Nach jedem
// Schritt: nichts überlappt, Gruppen sind Reihen, und eine Gruppe, die nichts damit zu tun hat, bleibt liegen (es
// sei denn, sie lag einer gewachsenen Gruppe im Weg). Anlass: 9.11., Gruppen verschoben sich „randomly“.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanvasState, Group, ImageItem, Layout } from "../../../shared/contracts.ts";
import { groupArea } from "../../../shared/groups.ts";
import { LAYOUT_GAP, itemBox, layoutProblems, type Box } from "../../../shared/layout.ts";
import { dropLayout, groupLayout, previewDrag, reflowAfterRemove, resizeLayout, widthAt } from "./arrange-core.ts";

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)]!;

const apply = (s: CanvasState, l: Layout): CanvasState => {
  const at = new Map(l.items.map((p) => [p.id, p]));
  const exists = (id: string) => s.items.some((i) => i.id === id);
  return { ...s, items: s.items.map((i) => (at.has(i.id) ? { ...i, x: at.get(i.id)!.x, y: at.get(i.id)!.y } : i)), groups: l.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter(exists) })).filter((g) => g.itemIds.length) };
};
const ov = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const problems = (s: CanvasState) => layoutProblems(s.items, s.groups);

const posOf = (s: CanvasState, g: Group) => JSON.stringify(g.itemIds.map((id) => { const i = s.items.find((x) => x.id === id)!; return [i.x, i.y]; }));

function start(): CanvasState {
  const n = int(3, 9);
  const items: ImageItem[] = [];
  let x = 0;
  for (let k = 0; k < n; k++) {
    const w = pick([400, 1000, 1440]), h = pick([300, 800, 3000]);
    items.push({ id: `i${k}`, path: `/i${k}.png`, title: `i${k}`, imageWidth: w, imageHeight: h, scale: 1, x, y: 0, regions: [] });
    x += w + LAYOUT_GAP * 2;
  }
  return { name: "f", title: "f", items, groups: [], annotations: [], updatedAt: "" };
}

type Step = { name: string; next: CanvasState; involved: Set<string> };
function step(s: CanvasState, gid: () => string): Step | null {
  const kind = pick(["drag", "drag", "drag", "dragGroup", "remove", "group", "group", "resize", "resize"]);
  const center = (i: ImageItem) => ({ x: i.x + itemBox(i).w / 2, y: i.y + itemBox(i).h / 2 });
  if (kind === "drag" && s.items.length) {
    const ids = [...new Set([pick(s.items).id, ...(rnd() < 0.3 ? [pick(s.items).id] : [])])];
    // Ziel: oft in eine Gruppe (Zeiger über einem ihrer Bilder), sonst irgendwohin.
    let pointer: { x: number; y: number };
    const gi = s.groups.length ? pick(pick(s.groups).itemIds) : null; if (gi && !s.items.some((i) => i.id === gi)) throw new Error("Gruppe zeigt auf fehlendes Bild " + gi + " " + JSON.stringify(s.groups));
    if (gi && rnd() < 0.5) pointer = center(s.items.find((i) => i.id === gi)!);
    else pointer = { x: int(-3000, 12000), y: int(-3000, 6000) };
    const first = s.items.find((i) => i.id === ids[0])!;
    const c = center(first);
    const drag = { ids, group: null, dx: pointer.x - c.x, dy: pointer.y - c.y, pointer };
    const touched = new Set(s.groups.filter((g) => g.itemIds.some((id) => ids.includes(id))).map((g) => g.id));
    const next = apply(s, dropLayout(s, drag));
    for (const g of next.groups) if (g.itemIds.some((id) => ids.includes(id))) touched.add(g.id);
    const into = previewDrag(s, drag).target ? "in Gruppe" : "frei";
    return { name: `ziehe-${into} ${ids} nach ${Math.round(pointer.x)},${Math.round(pointer.y)}`, next, involved: touched };
  }
  if (kind === "dragGroup" && s.groups.length) {
    const g = pick(s.groups);
    const a = groupArea(g, s.items)!;
    const pointer = { x: int(-3000, 12000), y: int(-3000, 6000) };
    const drag = { ids: g.itemIds, group: g.id, dx: pointer.x - a.x, dy: pointer.y - a.y, pointer };
    return { name: `ziehe Gruppe ${g.title}`, next: apply(s, dropLayout(s, drag)), involved: new Set([g.id]) };
  }
  if (kind === "resize" && s.groups.length) {
    const g = pick(s.groups);
    const a = groupArea(g, s.items)!;
    const width = widthAt(s, g.id, a.x + int(0, 9000))!;
    return { name: `Breite ${g.title} auf ${width}`, next: apply(s, resizeLayout(s, g.id, width)), involved: new Set([g.id]) };
  }
  if (kind === "remove" && s.items.length > 2) {
    const ids = [pick(s.items).id];
    const touched = new Set(s.groups.filter((g) => g.itemIds.some((id) => ids.includes(id))).map((g) => g.id));
    const l = reflowAfterRemove(s, ids);
    const next = apply({ ...s, items: s.items.filter((i) => !ids.includes(i.id)) }, l);
    return { name: `lösche ${ids}`, next, involved: touched };
  }
  if (kind === "group" && s.items.length) {
    const ids = [...new Set(Array.from({ length: int(1, 3) }, () => pick(s.items).id))];
    const id = gid();
    const touched = new Set(s.groups.filter((g) => g.itemIds.some((x) => ids.includes(x))).map((g) => g.id));
    touched.add(id);
    return { name: `gruppiere ${ids} als ${id}`, next: apply(s, groupLayout(s, ids, { id, title: id })), involved: touched };
  }
  return null;
}

function fuzz(runs: number, first: number): string[] {
  seed = first;
const found = new Map<string, string>();
for (let r = 0; r < runs; r++) {
  let s = start();
  let n = 0;
  const gid = () => `G${++n}`;
  const log: string[] = [];
  for (let k = 0; k < 25; k++) {
    const st = step(s, gid);
    if (!st) continue;
    log.push(st.name);
    const bad = problems(st.next);
    // Unbeteiligte Gruppen dürfen sich nur bewegen, wenn sie etwas Bewegtem im Weg lagen (Platz machen).
    const movedAreas = st.next.groups.filter((g) => { const b = s.groups.find((x) => x.id === g.id); return !b || st.involved.has(g.id) || posOf(s, b) !== posOf(st.next, g); }).map((g) => groupArea(g, st.next.items)!);
    for (const g of s.groups) {
      const after = st.next.groups.find((x) => x.id === g.id);
      if (!st.involved.has(g.id) && after && JSON.stringify(after.itemIds) === JSON.stringify(g.itemIds) && posOf(s, g) !== posOf(st.next, after)) {
        const old = groupArea(g, s.items)!;
        const inWay = movedAreas.some((m) => m !== groupArea(after, st.next.items) && ov({ x: old.x - 360, y: old.y - 360, w: old.w + 720, h: old.h + 720 }, m));
        if (!inWay) bad.push(`Gruppe ${g.title} unbeteiligt, aber verschoben`);
      }
    }
    if (bad.length && !problems(s).length) {
      const key = `${st.name.split(" ")[0]} → ${bad[0]!.replace(/[A-Za-z]+\d+/g, "#")}`;
      if (!found.has(key)) found.set(key, `Lauf ${r}, Schritt ${k}: ${bad.join("; ")}\n    ${log.slice(-4).join("\n    ")}`);
      break;
    }
    s = st.next;
  }
}
  return [...found].map(([k, v]) => `${k}\n  ${v}`);
}

for (const first of [1, 7, 13]) test(`Zufallsläufe (Seed ${first}): nichts überlappt, Gruppen bleiben Reihen, Unbeteiligtes bleibt liegen`, () => {
  assert.deepEqual(fuzz(400, first), []);
});
