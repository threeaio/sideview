import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanvasState, ImageItem } from "../../../shared/contracts.ts";
import { LAYOUT_GAP } from "../../../shared/layout.ts";
import { dropLayout, hitArrange, itemsInRect, previewDrag, reflowAfterRemove, selectedItemIds } from "./arrange-core.ts";

const item = (id: string, x: number, y = 0): ImageItem => ({ id, path: `/${id}.png`, title: id, imageWidth: 1000, imageHeight: 500, scale: 1, x, y, regions: [] });
// Gruppe a, b, c als Reihe; d frei rechts daneben.
const S = LAYOUT_GAP + 1000;
const state: CanvasState = {
  name: "t",
  title: "t",
  items: [item("a", 0), item("b", S), item("c", 2 * S), item("d", 4 * S)],
  groups: [{ id: "g", title: "Folien", itemIds: ["a", "b", "c"] }],
  annotations: [],
  updatedAt: "",
};
const xOf = (l: { items: { id: string; x: number }[] }, id: string) => l.items.find((i) => i.id === id)!.x;

test("Treffer: Bild vor Gruppe, Gruppenfläche und ihr Name, sonst nichts", () => {
  assert.deepEqual(hitArrange(state, { x: 10, y: 10 }, 1), { kind: "item", id: "a" });
  assert.deepEqual(hitArrange(state, { x: 1100, y: 10 }, 1), { kind: "group", id: "g" });
  assert.deepEqual(hitArrange(state, { x: -150, y: -170 }, 1), { kind: "group", id: "g" });
  assert.equal(hitArrange(state, { x: 3 * S + 100, y: 10 }, 1), null);
  assert.deepEqual(itemsInRect(state.items, { x: 900, y: 100, w: 400, h: 10 }), ["a", "b"]);
  assert.deepEqual(selectedItemIds(state, { kind: "group", id: "g" }), ["a", "b", "c"]);
});

test("Vorschau: Zeiger über der Gruppe lässt eine Lücke, außerhalb schließt sich die Reihe", () => {
  // a nach rechts zwischen b und c ziehen
  const inside = previewDrag(state, { ids: ["a"], group: null, dx: 1700, dy: 0, pointer: { x: S + 200, y: 250 } });
  assert.deepEqual(inside.target, { groupId: "g", index: 1 });
  assert.equal(inside.view.items.find((i) => i.id === "b")!.x, 0, "b rückt an den Anfang");
  assert.equal(inside.slot!.x, S);
  // weit nach unten: kein Ziel, b und c rücken auf
  const outside = previewDrag(state, { ids: ["a"], group: null, dx: 0, dy: 3000, pointer: { x: 500, y: 3250 } });
  assert.equal(outside.target, null);
  assert.equal(outside.view.items.find((i) => i.id === "c")!.x, S);
});

test("Ablegen: in die Lücke, heraus ohne Überlappung, Gruppe als Block", () => {
  const into = dropLayout(state, { ids: ["a"], group: null, dx: 1700, dy: 0, pointer: { x: S + 200, y: 250 } });
  assert.deepEqual(into.groups[0]!.itemIds, ["b", "a", "c"]);
  assert.deepEqual([xOf(into, "b"), xOf(into, "a"), xOf(into, "c")], [0, S, 2 * S]);
  // d in die Gruppe ans Ende
  const join = dropLayout(state, { ids: ["d"], group: null, dx: -2 * S + 300, dy: 0, pointer: { x: 2 * S + 900, y: 250 } });
  assert.deepEqual(join.groups[0]!.itemIds, ["a", "b", "c", "d"]);
  assert.equal(xOf(join, "d"), 3 * S);
  // a frei abgelegt, genau auf d: rückt heraus, Gruppe schließt sich
  const out = dropLayout(state, { ids: ["a"], group: null, dx: 4 * S, dy: 0, pointer: { x: 4 * S + 500, y: 250 } });
  assert.deepEqual(out.groups[0]!.itemIds, ["b", "c"]);
  const a = out.items.find((i) => i.id === "a")!;
  assert.ok(Math.abs(a.x - 4 * S) >= 1000 + LAYOUT_GAP || Math.abs(a.y) >= 500 + LAYOUT_GAP, `a liegt auf d: ${JSON.stringify(a)}`);
  // ganze Gruppe auf d geschoben: rückt als Block heraus
  const block = dropLayout(state, { ids: ["a", "b", "c"], group: "g", dx: 1500, dy: 0, pointer: { x: 0, y: 0 } });
  const dx = xOf(block, "a");
  assert.ok(dx + 3 * S - LAYOUT_GAP + 160 <= 4 * S || dx >= 5 * S, `Gruppe überdeckt d: ${dx}`);
});

test("Löschen schließt die Reihe", () => {
  const l = reflowAfterRemove(state, ["a"]);
  assert.deepEqual([xOf(l, "b"), xOf(l, "c")], [0, S]);
  assert.deepEqual(l.groups[0]!.itemIds, ["b", "c"]);
});

test("Gruppieren: Reihe ab links oben, alte Gruppe schließt sich, Name frei", async () => {
  const { groupLayout, nextGroupTitle } = await import("./arrange-core.ts");
  assert.equal(nextGroupTitle([{ id: "x", title: "Gruppe 1", itemIds: [] }]), "Gruppe 2");
  assert.equal(nextGroupTitle([{ id: "x", title: "Group 1", itemIds: [] }], "en"), "Group 2");
  // c (aus der Gruppe) und d (frei) gruppieren
  const l = groupLayout(state, ["d", "c"], { id: "n", title: "Gruppe 1" });
  const neu = l.groups.find((g) => g.id === "n")!;
  assert.deepEqual(neu.itemIds, ["c", "d"]);
  assert.deepEqual(l.groups.find((g) => g.id === "g")!.itemIds, ["a", "b"]);
  const [c, d] = [l.items.find((i) => i.id === "c")!, l.items.find((i) => i.id === "d")!];
  assert.equal(d.x - c.x, 1000 + LAYOUT_GAP);
  assert.equal(d.y, c.y);
});
