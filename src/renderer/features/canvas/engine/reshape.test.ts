import { test } from "node:test";
import assert from "node:assert/strict";
import { reshapeRect } from "./reshape.ts";

const image = { x: 0, y: 0, w: 1000, h: 800 };
const r = { x: 100, y: 100, w: 200, h: 100 };

test("Ecke und Kante ändern nur ihre Seiten", () => {
  assert.deepEqual(reshapeRect(r, "se", 50, 20, image, 10), { x: 100, y: 100, w: 250, h: 120 });
  assert.deepEqual(reshapeRect(r, "n", 0, -40, image, 10), { x: 100, y: 60, w: 200, h: 140 });
  assert.deepEqual(reshapeRect(r, "w", 30, 99, image, 10), { x: 130, y: 100, w: 170, h: 100 });
});

test("Rahmen bleibt im Bild und nie kleiner als das Minimum", () => {
  assert.deepEqual(reshapeRect(r, "nw", -500, -500, image, 10), { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(reshapeRect(r, "e", -500, 0, image, 10), { x: 100, y: 100, w: 10, h: 100 });
});

test("Griff verschiebt, ohne die Größe zu ändern, und stößt am Bildrand an", () => {
  assert.deepEqual(reshapeRect(r, "move", 30, -20, image, 10), { x: 130, y: 80, w: 200, h: 100 });
  assert.deepEqual(reshapeRect(r, "move", 5000, 5000, image, 10), { x: 800, y: 700, w: 200, h: 100 });
});
