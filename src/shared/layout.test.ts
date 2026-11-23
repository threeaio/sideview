import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImageItem } from "./contracts.ts";
import { LAYOUT_GAP, freeSpot, insertIndex, rowPositions } from "./layout.ts";

const item = (id: string, x: number, w = 1000): ImageItem => ({ id, path: "", title: id, imageWidth: w, imageHeight: 500, scale: 1, x, y: 0, regions: [] });

test("Reihe mit Abstand, Platzhalter schiebt die Nachbarn", () => {
  const order = [item("a", 0), item("b", 0, 500)];
  assert.deepEqual(rowPositions(order, { x: 10, y: 20 }, 99999).positions, [
    { id: "a", x: 10, y: 20 },
    { id: "b", x: 10 + 1000 + LAYOUT_GAP, y: 20 },
  ]);
  const withSlot = rowPositions(order, { x: 0, y: 0 }, 99999, { index: 1, w: 300, h: 100 });
  assert.equal(withSlot.slot!.x, 1000 + LAYOUT_GAP);
  assert.equal(withSlot.positions[1]!.x, 1000 + LAYOUT_GAP + 300 + LAYOUT_GAP);
  assert.equal(rowPositions(order, { x: 0, y: 0 }, 99999, { index: 2, w: 300, h: 100 }).slot!.x, 1000 + LAYOUT_GAP + 500 + LAYOUT_GAP);
});

test("Umbruch: was nicht mehr in die Breite passt, beginnt eine neue Zeile unter der höchsten der Zeile", () => {
  const tall = { ...item("a", 0), imageHeight: 900 };
  const order = [tall, item("b", 0), item("c", 0), item("d", 0, 3000)];
  const row = rowPositions(order, { x: 0, y: 0 }, 2200);
  assert.deepEqual(row.positions, [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 1000 + LAYOUT_GAP, y: 0 },
    { id: "c", x: 0, y: 900 + LAYOUT_GAP },
    // breiter als die Gruppe: allein in einer Zeile
    { id: "d", x: 0, y: 900 + LAYOUT_GAP + 500 + LAYOUT_GAP },
  ]);
  // Die Lücke bricht mit um.
  assert.deepEqual(rowPositions(order.slice(0, 2), { x: 0, y: 0 }, 2200, { index: 2, w: 600, h: 100 }).slot, { x: 0, y: 900 + LAYOUT_GAP });
});

test("Einfügestelle nach Zeiger", () => {
  const order = [item("a", 0), item("b", 1200)];
  assert.equal(insertIndex(order, { x: 100, y: 0 }), 0);
  assert.equal(insertIndex(order, { x: 900, y: 0 }), 1);
  assert.equal(insertIndex(order, { x: 5000, y: 0 }), 2);
  // zwei Zeilen: a, b oben, c darunter
  const lines = [item("a", 0), item("b", 1200), { ...item("c", 0), y: 700 }];
  assert.equal(insertIndex(lines, { x: 5000, y: 100 }), 2, "rechts neben der ersten Zeile: vor c");
  assert.equal(insertIndex(lines, { x: 100, y: 800 }), 2, "zweite Zeile vorn");
  assert.equal(insertIndex(lines, { x: 5000, y: 9000 }), 3, "unter allem: ans Ende");
});

test("freie Stelle: frei bleibt, überdeckt rückt den kürzesten Weg heraus", () => {
  const others = [{ x: 0, y: 0, w: 1000, h: 500 }];
  assert.deepEqual(freeSpot({ x: 2000, y: 0, w: 100, h: 100 }, others), { x: 2000, y: 0 });
  // knapp rechts überlappend: nach rechts heraus
  assert.deepEqual(freeSpot({ x: 900, y: 0, w: 400, h: 400 }, others), { x: 1000 + LAYOUT_GAP, y: 0 });
  // unten überlappend: nach unten
  assert.deepEqual(freeSpot({ x: 100, y: 450, w: 400, h: 400 }, others), { x: 100, y: 500 + LAYOUT_GAP });
});
