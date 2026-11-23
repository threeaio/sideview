// Kamera und Geometrie der Fläche, ohne DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EASE_IN_OUT, fitRect, flightMs, panBy, screenToWorld, worldToScreen, zoomAt, zoomPath, type Camera } from "./camera.ts";
import { contentBounds, findRegion, imageToWorld, itemAt, largestOverlap, rectFromPoints, worldToImage } from "./geometry.ts";
import { attachedPosition } from "./placement.ts";
import type { ImageItem } from "../../../../shared/contracts.ts";

const vp = { w: 1280, h: 800 };
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const desktop: ImageItem = {
  id: "d", path: "/x/desktop.png", title: "desktop", imageWidth: 1440, imageHeight: 13628, scale: 1, x: 0, y: 0,
  regions: [{ label: "Kopf", kind: "head", heading: null, aliases: ["kopf", "oben"], rect: [0, 0, 1440, 900] }],
};
const mobile: ImageItem = { id: "m", path: "/x/mobile.png", title: "mobile", imageWidth: 780, imageHeight: 38992, scale: 2, x: 1640, y: 0, regions: [] };

test("Zoom am Zeiger hält den Weltpunkt unter dem Zeiger fest", () => {
  const cam: Camera = { x: 100, y: 200, z: 0.5 };
  const p = { x: 640, y: 400 };
  const before = screenToWorld(cam, p);
  const after = screenToWorld(zoomAt(cam, p, 2.5), p);
  near(before.x, after.x);
  near(before.y, after.y);
});

test("Verschieben und Umrechnen sind zueinander stimmig", () => {
  const cam: Camera = { x: 10, y: 20, z: 2 };
  const moved = panBy(cam, 100, -40);
  const p = worldToScreen(moved, screenToWorld(cam, { x: 0, y: 0 }));
  near(p.x, 100);
  near(p.y, -40);
});

test("Einpassen zeigt das Rechteck ganz und mittig", () => {
  const cam = fitRect({ x: 0, y: 0, w: 1440, h: 900 }, vp, { padding: 40 });
  const tl = worldToScreen(cam, { x: 0, y: 0 });
  const br = worldToScreen(cam, { x: 1440, y: 900 });
  assert.ok(tl.x >= 39.9 && br.x <= 1240.1 && tl.y >= 39.9 && br.y <= 760.1);
  near((tl.x + br.x) / 2, 640, 1e-6);
});

test("Fahrt im Bogen beginnt und endet genau und geht unterwegs weiter heraus", () => {
  const from = fitRect({ x: 0, y: 0, w: 300, h: 200 }, vp);
  const to = fitRect({ x: 1640, y: 38000, w: 390, h: 500 }, vp);
  const path = zoomPath(from, to, vp);
  const start = path.at(0);
  const end = path.at(1);
  near(start.z, from.z, 1e-9);
  near(end.x, to.x, 1e-6);
  near(end.y, to.y, 1e-6);
  const mid = path.at(0.5);
  assert.ok(mid.z < Math.min(from.z, to.z) / 10, "unterwegs deutlich weiter heraus");
  assert.ok(flightMs(path.length) <= 1100 && flightMs(0) >= 380);
});

test("Reiner Zoom ohne Weg bleibt auf der Mitte", () => {
  const from: Camera = { x: 0, y: 0, z: 1 };
  const to: Camera = { x: 320, y: 200, z: 2 }; // gleiche Mitte bei 1280 × 800
  const mid = zoomPath(from, to, vp).at(0.5);
  near(mid.x + vp.w / mid.z / 2, 640, 1e-6);
  near(mid.y + vp.h / mid.z / 2, 400, 1e-6);
});

test("Kurve läuft von 0 nach 1 und steigt stetig", () => {
  near(EASE_IN_OUT(0), 0);
  near(EASE_IN_OUT(1), 1);
  let last = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const v = EASE_IN_OUT(t);
    assert.ok(v >= last - 1e-9, `fällt bei ${t}`);
    last = v;
  }
  assert.ok(EASE_IN_OUT(0.1) < 0.05 && EASE_IN_OUT(0.9) > 0.95, "langsam los, langsam an");
});

test("Bildpixel und Welt: Maßstab 2 halbiert, hin und zurück ohne Verlust", () => {
  const w = imageToWorld(mobile, [100, 2000, 400, 300]);
  assert.deepEqual(w, { x: 1640 + 50, y: 1000, w: 200, h: 150 });
  assert.deepEqual(worldToImage(mobile, w), [100, 2000, 400, 300]);
  assert.deepEqual(worldToImage(desktop, { x: -50, y: 10, w: 100, h: -20 }), [0, 0, 50, 10]);
});

test("Treffer, Umriss und Bereich", () => {
  assert.equal(itemAt([desktop, mobile], { x: 1700, y: 100 })?.id, "m");
  assert.equal(itemAt([desktop, mobile], { x: 1500, y: 100 }), null);
  assert.deepEqual(contentBounds([desktop, mobile]), { x: 0, y: 0, w: 1640 + 390, h: 19496 > 13628 ? 19496 : 13628 });
  assert.equal(findRegion([mobile, desktop], "OBEN")?.region.label, "Kopf");
  assert.deepEqual(rectFromPoints({ x: 10, y: 50 }, { x: 0, y: 0 }), { x: 0, y: 0, w: 10, h: 50 });
});

test("Notizfeld bleibt im Bild: unten, sonst oben, sonst an den Rand geschoben", () => {
  const view = { w: 1400, h: 868 };
  const box = { w: 300, h: 110 };
  // Platz unten
  assert.deepEqual(attachedPosition("editor", { x0: 100, y0: 100, x1: 500, y1: 400 }, box, view), { x: 99, y: 408 });
  // Rechteck reicht unten aus dem Bild (sein Fall am 4.11.): Feld darüber
  assert.deepEqual(attachedPosition("editor", { x0: 186, y0: 334, x1: 825, y1: 896 }, box, view), { x: 185, y: 216 });
  // weder unten noch oben Platz: am unteren Rand, ganz im Bild
  const tall = attachedPosition("editor", { x0: 1300, y0: 20, x1: 1600, y1: 900 }, box, view);
  assert.deepEqual(tall, { x: 1400 - 8 - 300, y: 868 - 8 - 110 });
});

test("Notizfeld bleibt über der Werkzeugleiste unten (22.11.: Bedienelemente überlappen)", () => {
  const view = { w: 1400, h: 868, bottom: 76 };
  const box = { w: 300, h: 110 };
  // Unten wäre Platz bis zum Fensterrand, aber nicht bis zur Werkzeugleiste: Feld darüber
  assert.deepEqual(attachedPosition("editor", { x0: 186, y0: 334, x1: 825, y1: 700 }, box, view), { x: 185, y: 216 });
  // weder unten noch oben Platz: über der Werkzeugleiste
  const tall = attachedPosition("editor", { x0: 1300, y0: 20, x1: 1600, y1: 900 }, box, view);
  assert.equal(tall.y, 868 - 76 - 8 - 110);
});

test("Beschriftung hängt über dem Rechteck und bleibt am oberen Rand, solange es zu sehen ist", () => {
  const view = { w: 1400, h: 868 };
  const box = { w: 200, h: 24 };
  assert.deepEqual(attachedPosition("label", { x0: 100, y0: 200, x1: 500, y1: 400 }, box, view), { x: 99, y: 170 });
  assert.deepEqual(attachedPosition("label", { x0: -300, y0: -500, x1: 500, y1: 400 }, box, view), { x: 8, y: 8 });
  // Rechteck fast oben hinaus: Beschriftung geht mit seiner Unterkante
  assert.deepEqual(attachedPosition("label", { x0: 100, y0: -500, x1: 500, y1: 20 }, box, view), { x: 99, y: -4 });
  // ganz außerhalb: natürliche Lage
  assert.deepEqual(attachedPosition("label", { x0: 100, y0: -500, x1: 500, y1: -100 }, box, view), { x: 99, y: -530 });
});

test("Rahmen neben dem Bild begonnen gehört zum Bild, das er am meisten überdeckt", () => {
  const a = { id: "a", path: "/a.png", title: "a", imageWidth: 1000, imageHeight: 1000, scale: 1, x: 0, y: 0, regions: [] } satisfies ImageItem;
  const b = { ...a, id: "b", x: 1200 };
  assert.equal(largestOverlap([a, b], { x: -100, y: -100, w: 300, h: 300 })?.id, "a");
  assert.equal(largestOverlap([a, b], { x: 900, y: 0, w: 500, h: 100 })?.id, "b");
  assert.equal(largestOverlap([a, b], { x: 1050, y: -50, w: 100, h: 20 }), null);
});

test("volle Breite vom Anfang an: höchstens Originalgröße, oben angesetzt; sameView erkennt die Lage", async () => {
  const { fitWidthTop, fitRect, sameView } = await import("./camera.ts");
  const page = { x: 0, y: 0, w: 1440, h: 24000 };
  const vp = { w: 1200, h: 800 };
  const wide = fitWidthTop(page, vp, { padding: 64, maxZoom: 1 });
  assert.ok(Math.abs(wide.z - (1200 - 128) / 1440) < 1e-9, "Breite füllt den Platz");
  assert.ok(Math.abs(wide.y - -64 / wide.z) < 1e-9, "oben angesetzt, Rand oben");
  const narrow = fitWidthTop({ x: 0, y: 0, w: 390, h: 24000 }, vp, { padding: 64, maxZoom: 1 });
  assert.equal(narrow.z, 1, "nie über die Originalgröße");
  const whole = fitRect(page, vp, { padding: 64, maxZoom: 1 });
  assert.ok(whole.z < wide.z / 10, "ganz gezeigt ist die lange Seite winzig");
  assert.ok(sameView(whole, { ...whole, x: whole.x + 1 / whole.z }));
  assert.ok(!sameView(whole, wide));
});
