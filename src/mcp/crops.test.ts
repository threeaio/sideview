import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import sharp from "sharp";
import { cropAnnotation, paddedRect, regionAt } from "./crops.ts";
import type { ImageItem, Region } from "../shared/contracts.ts";
import { DESKTOP_SIZE, FIXTURE_DIR } from "../../test/fixtures/stage.ts";

const DESKTOP = path.join(FIXTURE_DIR, "desktop.png");
const { width: W, height: H } = DESKTOP_SIZE;

test("Rand bleibt im Bild", () => {
  assert.deepEqual(paddedRect([0, 0, 100, 50], 1440, 900), [0, 0, 112, 62]);
  assert.deepEqual(paddedRect([1400, 880, 40, 20], 1440, 900), [1395, 875, 45, 25]);
});

test("Bereich nach der Mitte des Rechtecks", () => {
  const regions: Region[] = [
    { label: "Kopf", kind: "head", heading: null, aliases: [], rect: [0, 0, 1440, 900] },
    { label: "Pfannen", kind: "section", heading: null, aliases: [], rect: [0, 900, 1440, 1475] },
  ];
  assert.equal(regionAt(regions, [100, 800, 200, 200])?.label, "Pfannen");
  assert.equal(regionAt(regions, [100, 100, 200, 200])?.label, "Kopf");
  assert.equal(regionAt(regions, [100, 99999, 10, 10]), null);
});

test("Ausschnitt aus dem Screenshot", async () => {
  const item: ImageItem = { id: "d", path: DESKTOP, title: "desktop", imageWidth: W, imageHeight: H, scale: 1, x: 0, y: 0, regions: [] };
  const crop = await cropAnnotation(item, { id: "n", itemId: "d", rect: [0, 0, 1440, 900], note: "Kopf", createdAt: "", source: "text" });
  const meta = await sharp(Buffer.from(crop.data, "base64")).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok((meta.width ?? 0) <= 1200 && (meta.height ?? 0) <= 1200);
  assert.deepEqual(crop.rect, [0, 0, 1440, 1073]);
});

test("Punkt: Ausschnitt mit Umgebung und Ring um die Stelle", async () => {
  const item: ImageItem = { id: "d", path: DESKTOP, title: "desktop", imageWidth: W, imageHeight: H, scale: 1, x: 0, y: 0, regions: [] };
  assert.deepEqual(paddedRect([700, 500, 0, 0], W, H), [380, 180, 640, 640]);
  assert.deepEqual(paddedRect([10, 10, 0, 0], W, H), [0, 0, 330, 330]);
  const crop = await cropAnnotation(item, { rect: [700, 500, 0, 0] });
  const meta = await sharp(Buffer.from(crop.data, "base64")).metadata();
  assert.deepEqual([meta.width, meta.height], [640, 640]);
});
