import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP, clampRect, resolveAnnotations, resolveRemoval, defaultTitle, emptyCanvas, uniqueTitle, fromJsonCanvas, placeDropped, placeRight, slugify, toJsonCanvas } from "./canvas-core.ts";
import type { Annotation, CanvasState, ImageItem } from "../shared/contracts.ts";

const item = (over: Partial<ImageItem>): ImageItem => ({
  id: "a",
  path: "/tmp/a.png",
  title: "a",
  imageWidth: 1440,
  imageHeight: 13628,
  scale: 1,
  x: 0,
  y: 0,
  regions: [],
  ...over,
});

test("neue Bilder kommen rechts neben die vorhandenen, Maßstab zählt", () => {
  assert.deepEqual(placeRight([]), { x: 0, y: 0 });
  assert.deepEqual(placeRight([item({})]), { x: 1440 + GAP, y: 0 });
  assert.deepEqual(placeRight([item({ imageWidth: 780, scale: 2, x: 100 })]), { x: 100 + 390 + GAP, y: 0 });
});

test("abgelegte Bilder: das erste mittig auf dem Punkt, weitere rechts daneben", () => {
  const first = placeDropped({ x: 1000, y: 500 }, { width: 400, height: 300 }, null);
  assert.deepEqual(first, { x: 800, y: 350 });
  const prev = item({ imageWidth: 800, imageHeight: 600, scale: 2, ...first });
  assert.deepEqual(placeDropped({ x: 1000, y: 500 }, { width: 100, height: 100 }, prev), { x: 800 + 400 + GAP, y: 350 });
});

test("JSON Canvas hin und zurück verliert nichts außer abgeleiteten Bereichen", () => {
  const state: CanvasState = {
    ...emptyCanvas("lauf-20", "Lauf 20", "2026-11-04T17:00:00.000Z"),
    items: [item({ regions: [{ label: "Kopf", kind: "head", heading: null, aliases: [], rect: [0, 0, 1440, 900] }] })],
    annotations: [{ id: "n1", itemId: "a", rect: [10, 20, 300, 200], note: "Logo zu klein", createdAt: "2026-11-04T17:01:00.000Z", source: "voice" }],
  };
  const file = toJsonCanvas(state);
  assert.equal(file.nodes[0]?.type, "file");
  const back = fromJsonCanvas("lauf-20", JSON.parse(JSON.stringify(file)));
  assert.deepEqual(back, { ...state, items: [{ ...state.items[0]!, regions: [] }] });
});

test("fremde Knoten in der Datei bleiben unbeachtet", () => {
  const back = fromJsonCanvas("x", { nodes: [{ id: "t", type: "text", text: "Hallo", x: 0, y: 0, width: 10, height: 10 }], edges: [] });
  assert.equal(back.items.length, 0);
});

test("Namen werden zu Dateinamen", () => {
  assert.equal(slugify("Lauf 20 – Röstung Guß"), "lauf-20-roestung-guss");
  assert.equal(slugify("../../etc"), "etc");
  assert.equal(slugify("   "), "flaeche");
});

test("Rechtecke bleiben im Bild", () => {
  assert.deepEqual(clampRect([-10, -10, 100, 100], 1440, 900), [0, 0, 90, 90]);
  assert.deepEqual(clampRect([1400, 850, 100, 100], 1440, 900), [1400, 850, 40, 50]);
});

test("Namen: Seite und Ansicht statt „desktop“, sonst Dateiname ohne Endung", () => {
  assert.equal(defaultTitle("/x/heise/desktop.png", { source: "https://www.heise.de/", view: "desktop" }), "heise.de Desktop");
  assert.equal(defaultTitle("/x/heise/mobile.png", { source: "https://www.heise.de/", view: "mobile" }), "heise.de Handy");
  assert.equal(defaultTitle("/home/n/Desktop/Bildschirmfoto 2026-11-05.png", null), "Bildschirmfoto 2026-11-05");
  assert.equal(defaultTitle("/x/runs/kaffee/run20-with/shots/desktop.png", null), "run20-with Desktop");
});

test("Namen sind je Fläche eindeutig, ohne Rücksicht auf Groß und Klein", () => {
  assert.equal(uniqueTitle("Frame 13", []), "Frame 13");
  assert.equal(uniqueTitle("Frame 13", ["frame 13"]), "Frame 13 2");
  assert.equal(uniqueTitle("Frame 13", ["Frame 13", "Frame 13 2"]), "Frame 13 3");
});

test("Gruppen: Fläche aus den Bildern, neue Gruppe hält Abstand, JSON Canvas hin und zurück", async () => {
  const { GROUP_PAD, GROUP_PAD_TOP, groupArea } = await import("../shared/groups.ts");
  const a = item({ id: "a", imageWidth: 1920, imageHeight: 1080 });
  const b = item({ id: "b", imageWidth: 1920, imageHeight: 1080, x: 1920 + GAP });
  const group = { id: "g", title: "Mostly Air", itemIds: ["a", "b"] };
  assert.deepEqual(groupArea(group, [a, b]), { x: -GROUP_PAD, y: -GROUP_PAD_TOP, w: 2 * 1920 + GAP + 2 * GROUP_PAD, h: 1080 + GROUP_PAD + GROUP_PAD_TOP });
  // Nächstes Bild außerhalb der Gruppe: rechts neben ihrem Rand. Beginnt es eine neue Gruppe: noch deren Rand dazu.
  const right = 2 * 1920 + GAP + GROUP_PAD;
  assert.deepEqual(placeRight([a, b], [group]), { x: right + GAP, y: 0 });
  assert.deepEqual(placeRight([a, b], [group], { id: "h", title: "Neu", itemIds: [] }), { x: right + GAP + GROUP_PAD, y: 0 });
  // In die Gruppe hinein: nur Abstand zum letzten Bild.
  assert.deepEqual(placeRight([a, b], [group], group), { x: 2 * 1920 + GAP + GAP, y: 0 });

  const state: CanvasState = { ...emptyCanvas("figma", "Figma", "2026-11-05T12:00:00.000Z"), items: [a, b], groups: [group] };
  const file = toJsonCanvas(state);
  assert.equal(file.nodes[0]?.type, "group");
  assert.equal((file.nodes[0] as { label: string }).label, "Mostly Air");
  const back = fromJsonCanvas("figma", JSON.parse(JSON.stringify(file)));
  assert.deepEqual(back.groups, [group]);
  // Gezogene Breite bleibt erhalten.
  const narrow = { ...group, maxWidth: 2500 };
  assert.deepEqual(fromJsonCanvas("figma", JSON.parse(JSON.stringify(toJsonCanvas({ ...state, groups: [narrow] })))).groups, [narrow]);
  // Bild fehlt: Gruppe verliert es; ohne Bilder fällt sie weg.
  const gone = fromJsonCanvas("figma", { ...file, nodes: file.nodes.filter((n) => n.id === "g") });
  assert.deepEqual(gone.groups, []);
});

const note = (id: string): Annotation => ({ id, itemId: "a", rect: [0, 0, 10, 10], note: id, createdAt: "t", source: "text" });

test("Anmerkungen über Nummer oder id finden, Nummern vor der Änderung, Unbekanntes gemeldet", () => {
  const all = [note("x1"), note("x2"), note("x3")];
  assert.deepEqual(resolveAnnotations(all, ["2", "#3", "x1", "x2"]), { ids: ["x2", "x3", "x1"], missing: [] });
  assert.deepEqual(resolveAnnotations(all, ["4", "zz"]), { ids: [], missing: ["4", "zz"] });
});

test("resolveRemoval: Bild über id, Nummer oder eindeutigen Titel, Gruppe über Namen mit allen Bildern", () => {
  const items = [item({ id: "a", title: "Start" }), item({ id: "b", title: "Kopf" }), item({ id: "c", title: "Kopf" }), item({ id: "d", title: "Fuß" })];
  const groups = [{ id: "g1", title: "Gruppe 2", itemIds: ["b", "c"] }];
  assert.deepEqual(resolveRemoval({ items, groups }, { images: ["start", "#4", "a"] }), { ids: ["a", "d"], groups: [], missing: [] });
  assert.deepEqual(resolveRemoval({ items, groups }, { groups: ["gruppe 2"] }), { ids: ["b", "c"], groups: ["Gruppe 2"], missing: [] });
  assert.deepEqual(resolveRemoval({ items, groups }, { images: ["Kopf", "9"], groups: ["x"] }).missing, ["Bild Kopf", "Bild 9", "Gruppe x"], "doppelter Titel ist nicht eindeutig");
});
