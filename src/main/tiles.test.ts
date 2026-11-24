import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pyramidLevels } from "./tiles-worker.ts";

import { DESKTOP_SIZE, FIXTURE_DIR } from "../../test/fixtures/stage.ts";

// Ganzseitiger Screenshot aus test/fixtures, 1440 × 6000.
const DESKTOP = path.join(FIXTURE_DIR, "desktop.png");
let tmp = "";

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-tiles-"));
  process.env.CANVAS_DATA = tmp;
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

test("Stufen einer Pyramide nach Deep Zoom", () => {
  const levels = pyramidLevels(1440, 13628);
  assert.equal(levels.length, 15); // ceil(log2(13628)) = 14, Stufen 0 bis 14
  assert.deepEqual(levels.at(-1), { level: 14, width: 1440, height: 13628, cols: 3, rows: 27 });
  assert.deepEqual(levels[0], { level: 0, width: 1, height: 1, cols: 1, rows: 1 });
});

test("Kacheln für einen ganzseitigen Screenshot entstehen einmal und liegen dann bereit", async () => {
  const { ensureTiles, tileFile } = await import("./tiles.ts");
  const t0 = performance.now();
  const manifest = await ensureTiles(DESKTOP);
  const first = performance.now() - t0;
  assert.equal(manifest.width, DESKTOP_SIZE.width);
  assert.equal(manifest.maxLevel, 13); // ceil(log2(6000))
  const file = tileFile(manifest.key, "13/2_11.png");
  assert.ok(file);
  await fs.access(file);
  const t1 = performance.now();
  assert.equal((await ensureTiles(DESKTOP)).key, manifest.key);
  assert.ok(performance.now() - t1 < first / 4, "zweiter Aufruf kommt aus dem Speicher");
  assert.equal(tileFile(manifest.key, "../../etc/passwd"), null);
  assert.equal(tileFile("../x", "1/0_0.png"), null);
});

test("verwaiste Kacheln werden gelöscht, benutzte und frische bleiben", async () => {
  const { pruneTiles, tileKeyFor } = await import("./tiles.ts");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tiles-prune-"));
  const dir = path.join(root, "tiles");
  const image = path.join(root, "bild.png");
  await fs.writeFile(image, "x");
  const used = await tileKeyFor(image);
  const old = "0123456789abcdef";
  const fresh = "fedcba9876543210";
  for (const k of [used, old, fresh]) {
    await fs.mkdir(path.join(dir, k, "image_files", "0"), { recursive: true });
    await fs.writeFile(path.join(dir, k, "image_files", "0", "0_0.png"), "1234");
  }
  await fs.mkdir(path.join(dir, "kein-schluessel"));
  const now = Date.now();
  const long = new Date(now - 3 * 86_400_000);
  for (const k of [used, old]) await fs.utimes(path.join(dir, k), long, long);

  const result = await pruneTiles([image, path.join(root, "fehlt.png")], { dir, now });
  assert.deepEqual(result, { removed: 1, bytes: 4 });
  assert.deepEqual((await fs.readdir(dir)).sort(), [used, fresh, "kein-schluessel"].sort());
  await fs.rm(root, { recursive: true, force: true });
});
