import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRegions, knownRegions, pageOrigin } from "./regions.ts";

test("Bereiche aus regions.json neben dem Bild (page-shots)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regions-"));
  const image = path.join(dir, "desktop.png");
  const regions = [{ kind: "head", label: "Kopf", heading: null, aliases: ["kopf"], rect: [0, 0, 1440, 120] }];
  fs.writeFileSync(path.join(dir, "regions.json"), JSON.stringify({ views: { desktop: { image, scale: 1, regions } } }));
  const view = await ensureRegions(image, new Map());
  assert.equal(view?.regions[0]?.label, "Kopf");
  assert.equal(await ensureRegions(path.join(dir, "fehlt.png"), new Map()), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("nach einem Neustart findet die Fläche Bereiche neben dem Bild wieder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regions-"));
  const image = path.join(dir, "desktop.png");
  const regions = [{ kind: "head", label: "Kopf", heading: null, aliases: ["kopf"], rect: [0, 0, 1440, 120] }];
  fs.writeFileSync(path.join(dir, "regions.json"), JSON.stringify({ views: { desktop: { image, scale: 1, regions } } }));
  // Neuer, leerer Index wie nach dem Start der App.
  assert.equal((await knownRegions(image, new Map()))?.regions[0]?.label, "Kopf");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Herkunft eines page-shots-Bildes: Adresse und Ansicht", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regions-"));
  const image = path.join(dir, "mobile.png");
  fs.writeFileSync(path.join(dir, "regions.json"), JSON.stringify({ source: "https://www.heise.de/", views: { mobile: { image, scale: 2, regions: [] } } }));
  assert.deepEqual(await pageOrigin(image), { source: "https://www.heise.de/", view: "mobile" });
  assert.equal(await pageOrigin(path.join(dir, "desktop.png")), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
