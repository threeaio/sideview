import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageItem } from "../../../shared/contracts.ts";
import { annotationRect, compareWidth, defaultLeft, sheetIndexOf, sheetRect, sheetsOf, stepLeft } from "./version-compare.ts";

const v = (n: number, replacedAt: string, w = 2880, h = 9000) => ({ path: `/p/v${n}.png`, title: `V${n}`, imageWidth: w, imageHeight: h, scale: 0.5, replacedAt });
const item = (versions: ReturnType<typeof v>[]): ImageItem => ({
  id: "a",
  path: "/p/now.png",
  title: "Now",
  imageWidth: 2880,
  imageHeight: 12000,
  scale: 0.5,
  x: 0,
  y: 0,
  regions: [],
  versions,
});

test("Fassungen: älteste zuerst, die aktuelle zuletzt", () => {
  const sheets = sheetsOf(item([v(1, "2026-11-22T10:00:00Z"), v(2, "2026-11-23T10:00:00Z")]));
  assert.deepEqual(
    sheets.map((s) => [s.n, s.total, s.current, s.title]),
    [
      [1, 3, false, "V1"],
      [2, 3, false, "V2"],
      [3, 3, true, "Now"],
    ],
  );
});

test("gleiche Breite für alle Fassungen, Höhe nach Seitenverhältnis", () => {
  const it = item([v(1, "2026-11-22T10:00:00Z", 1440, 3000)]);
  const w = compareWidth(it);
  assert.equal(w, 1440);
  assert.deepEqual(sheetRect(sheetsOf(it)[0]!, w), { x: 0, y: 0, w: 1440, h: 3000 });
  assert.deepEqual(sheetRect(sheetsOf(it)[1]!, w), { x: 0, y: 0, w: 1440, h: 6000 });
});

test("Anmerkung gehört zu der Fassung, die galt, als sie entstand", () => {
  const it = item([v(1, "2026-11-22T10:00:00Z"), v(2, "2026-11-23T10:00:00Z")]);
  assert.equal(sheetIndexOf({ createdAt: "2026-11-21T09:00:00Z" }, it), 0);
  assert.equal(sheetIndexOf({ createdAt: "2026-11-22T12:00:00Z" }, it), 1);
  assert.equal(sheetIndexOf({ createdAt: "2026-11-23T12:00:00Z" }, it), 2);
  assert.equal(sheetIndexOf({ createdAt: "2026-11-23T12:00:00Z" }, item([])), 0);
});

test("Rechteck in Bildpixeln der Fassung auf die gemeinsame Breite", () => {
  assert.deepEqual(annotationRect([288, 100, 576, 50], { imageWidth: 2880 }, 1440), { x: 144, y: 50, w: 288, h: 25 });
});

test("links nur frühere Fassungen, Vorgabe die neueste davon", () => {
  const it = item([v(1, "2026-11-22T10:00:00Z"), v(2, "2026-11-23T10:00:00Z")]);
  assert.equal(defaultLeft(it), 1);
  assert.equal(stepLeft(1, 1, it), 1);
  assert.equal(stepLeft(1, -1, it), 0);
  assert.equal(stepLeft(0, -1, it), 0);
});
