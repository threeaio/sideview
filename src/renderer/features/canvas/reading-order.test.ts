import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImageItem } from "../../../shared/contracts.ts";
import { readingOrder } from "./reading-order.ts";

const item = (id: string): ImageItem => ({ id, path: `/${id}.png`, title: id, imageWidth: 100, imageHeight: 100, scale: 1, x: 0, y: 0, regions: [] });

test("Durchblättern: Reihenfolge wie im Inhaltsverzeichnis, eine Gruppe am Stück in ihrer Reihe, an der Stelle ihres ersten Bildes", () => {
  const items = ["a", "b", "c", "d", "e"].map(item);
  const groups = [{ id: "g", title: "Läufe", itemIds: ["e", "b"] }];
  assert.deepEqual(readingOrder({ items, groups }).map((i) => i.id), ["a", "e", "b", "c", "d"]);
  assert.deepEqual(readingOrder({ items: [], groups: [] }), []);
});
