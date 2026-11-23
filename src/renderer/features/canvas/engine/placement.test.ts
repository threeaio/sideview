import { test } from "node:test";
import assert from "node:assert/strict";
import { noteOffset, scrimSpread } from "./placement.ts";

const view = { w: 1000, h: 800, top: 60, bottom: 70 };
const pin = (x: number, y: number) => ({ x, y, w: 28, h: 28 });

test("Karte rechts neben der Nummer, unten bündig mit der Rahmenkante (Mitte der Nummer)", () => {
  assert.deepEqual(noteOffset(pin(100, 400), { w: 200, h: 90 }, view), { x: 32, y: -76 });
});

test("Karte links, wenn sie rechts nicht passt", () => {
  assert.deepEqual(noteOffset(pin(900, 400), { w: 200, h: 90 }, view), { x: -204, y: -76 });
});

test("Karte am rechten Rand, wenn sie auf keiner Seite passt", () => {
  const at = noteOffset(pin(150, 400), { w: 300, h: 90 }, { ...view, w: 320 });
  assert.equal(150 + at.x + 300, 320 - 8);
});

test("Lange Karte oben nie unter der Kopfzeile", () => {
  const at = noteOffset(pin(100, 80), { w: 300, h: 260 }, view);
  assert.equal(80 + at.y, 60 + 8);
});

test("Karte unten nie auf der Werkzeugleiste", () => {
  const at = noteOffset(pin(100, 760), { w: 300, h: 60 }, view);
  assert.ok(760 + at.y + 60 <= 800 - 70 - 8);
});

test("Karte nicht auf einer Bildmarke: dann unter der Nummer", () => {
  const mark = { x: 640, y: 380, w: 260, h: 30 };
  const at = noteOffset(pin(900, 400), { w: 200, h: 60 }, view, [mark]);
  assert.equal(at.y, 32);
});

test("Liegt die Marke überall im Weg, rutscht die Karte unter sie", () => {
  const mark = { x: 500, y: 380, w: 480, h: 40 };
  const at = noteOffset(pin(900, 400), { w: 200, h: 60 }, view, [mark]);
  assert.ok(400 + at.y >= 420);
  assert.ok(900 + at.x >= 8 && 900 + at.x + 200 <= 1000 - 8);
});

test("Abdunkelung deckt das Fenster auch bei einem Rahmen weit außerhalb", () => {
  const view = { w: 1280, h: 820 };
  const covers = (at: { x: number; y: number }, w: number, h: number) => {
    const s = scrimSpread(at, w, h, view);
    return at.x - s <= 0 && at.x + w + s >= view.w && at.y - s <= 0 && at.y + h + s >= view.h;
  };
  assert.ok(covers({ x: 100, y: 100 }, 200, 100));
  assert.ok(covers({ x: 4000, y: 9000 }, 300, 200));
  assert.ok(covers({ x: -6000, y: -3000 }, 50, 50));
  assert.ok(covers({ x: -10, y: -10 }, 3000, 3000));
});
