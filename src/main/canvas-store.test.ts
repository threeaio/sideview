// Ablage: Bilder verschieben, in Gruppen und heraus, löschen mit Rückgängig, Gruppe auflösen.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createCanvasStore } from "./canvas-store.ts";
import type { CanvasState } from "../shared/contracts.ts";
import { layoutProblems } from "../shared/layout.ts";

const problems = (s: CanvasState) => layoutProblems(s.items, s.groups);

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-store-"));
  const images = await Promise.all(
    ["a", "b", "c"].map(async (n) => {
      const file = path.join(dir, `${n}.png`);
      await sharp({ create: { width: 400, height: 300, channels: 3, background: "#808080" } }).png().toFile(file);
      return file;
    }),
  );
  const store = await createCanvasStore({ dir: path.join(dir, "canvases") });
  await store.open("t", { group: "Folien", images: images.slice(0, 2).map((p) => ({ path: p })) });
  const state = await store.open("t", { images: [{ path: images[2]! }] });
  return { store, state, dir };
}

test("Anordnung setzen: Lage und Gruppen, leere Gruppen fallen weg", async () => {
  const { store, state } = await setup();
  const [a, b, c] = state.items;
  const group = state.groups[0]!;
  assert.deepEqual(group.itemIds, [a!.id, b!.id]);
  await store.applyLayout("t", { items: [{ id: c!.id, x: 10.4, y: 20.6 }], groups: [{ ...group, itemIds: [c!.id, a!.id, b!.id, "weg"] }] });
  const moved = (await store.get("t"))!;
  assert.equal(moved.items.find((i) => i.id === c!.id)?.x, 10);
  assert.deepEqual(moved.groups[0]!.itemIds, [c!.id, a!.id, b!.id]);
  await store.applyLayout("t", { items: moved.items.map(({ id, x, y }) => ({ id, x, y })), groups: [] });
  assert.deepEqual((await store.get("t"))!.groups, []);
});

test("Anordnung setzen: Bilder, die Claude seitdem in eine Gruppe gelegt hat, bleiben darin (auch nach Rückgängig)", async () => {
  const { store, state, dir } = await setup();
  const old = { items: state.items.map(({ id, x, y }) => ({ id, x, y })), groups: state.groups };
  const extra = path.join(dir, "neu.png");
  await sharp({ create: { width: 400, height: 300, channels: 3, background: "#808080" } }).png().toFile(extra);
  const added = await store.open("t", { group: "Folien", images: [{ path: extra }] });
  const fresh = added.items.find((i) => i.path === extra)!;
  await store.applyLayout("t", old);
  const after = (await store.get("t"))!;
  assert.ok(after.groups[0]!.itemIds.includes(fresh.id));
  assert.deepEqual(problems(after), []);
});

test("Claude: Bilder in Gruppen legen, gruppieren und ersetzen lässt nichts überlappen", async () => {
  const { store, state, dir } = await setup();
  const make = async (name: string, width: number) => {
    const file = path.join(dir, name);
    await sharp({ create: { width, height: 300, channels: 3, background: "#808080" } }).png().toFile(file);
    return file;
  };
  // Neues Bild in die bestehende Gruppe: ans Ende der Reihe, das freie Bild rechts daneben rückt zur Seite.
  let s = await store.open("t", { group: "Folien", images: [{ path: await make("d.png", 400) }] });
  assert.deepEqual(problems(s), []);
  // Vorhandene Bilder zu einer neuen Gruppe: keine Bilder aufeinander.
  s = await store.open("t", { group: "Neu", images: [{ path: state.items[0]!.path }, { path: state.items[2]!.path }] });
  assert.deepEqual(problems(s), []);
  // Ein Bild durch ein viel breiteres ersetzen.
  s = await store.open("t", { images: [{ path: await make("breit.png", 3000), replaces: state.items[1]!.id }] });
  assert.deepEqual(problems(s), []);
});

test("löschen nimmt Anmerkungen mit, Rückgängig bringt Bilder, Anmerkungen und Gruppe zurück", async () => {
  const { store, state } = await setup();
  const [a, b] = state.items;
  await store.addAnnotation("t", { itemId: a!.id, rect: [0, 0, 50, 50], note: "x", source: "text" });
  const removed = await store.removeItems("t", [a!.id, b!.id]);
  const after = (await store.get("t"))!;
  assert.equal(after.items.length, 1);
  assert.equal(after.annotations.length, 0);
  assert.deepEqual(after.groups, []);
  await store.restoreItems("t", removed);
  const back = (await store.get("t"))!;
  assert.deepEqual(back.items.map((i) => i.id), state.items.map((i) => i.id), "alte Reihenfolge");
  assert.equal(back.annotations.length, 1);
  assert.deepEqual(back.groups.map((g) => [g.title, g.itemIds]), [["Folien", [a!.id, b!.id]]]);
});

test("vorhandene Bilder in eine neue Gruppe: Reihe ab dem Bild links oben", async () => {
  const { store, state } = await setup();
  const [, b, c] = state.items;
  const after = await store.open("t", { group: "Neu", images: [{ path: c!.path }, { path: b!.path }] });
  const neu = after.groups.find((g) => g.title === "Neu")!;
  assert.deepEqual(neu.itemIds, [c!.id, b!.id]);
  const [pc, pb] = [after.items.find((i) => i.id === c!.id)!, after.items.find((i) => i.id === b!.id)!];
  assert.equal(pb.x, pc.x + 400 + 200);
  assert.equal(pb.y, pc.y);
});

test("Herkunft: angegeben oder die Datei, bleibt in der Datei erhalten; Figma nur als Adresse des Frames", async () => {
  const { store, state } = await setup();
  assert.equal(state.items[0]!.origin?.kind, "file");
  assert.equal(state.items[0]!.origin?.ref, state.items[0]!.path);
  const dir = path.dirname(state.items[0]!.path);
  const d = path.join(dir, "d.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#808080" } }).png().toFile(d);
  const figma = { kind: "figma" as const, ref: "https://www.figma.com/design/ABC/Datei?node-id=1-2", detail: "Frame 1" };
  await store.open("t", { images: [{ path: d, origin: figma }] });
  const item = (await store.get("t"))!.items.find((i) => i.path === d)!;
  assert.deepEqual({ ...item.origin, fetchedAt: undefined }, { ...figma, fetchedAt: undefined });
  assert.ok(item.origin?.fetchedAt);
  await assert.rejects(
    store.open("t", { images: [{ path: d, origin: { kind: "figma", ref: "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/x" } }] }),
    /figma\.com address/,
  );
});

test("Bild tauschen: id, Lage, Gruppe und Anmerkungen bleiben, Datei, Größe und Herkunft neu, Reihe ordnet sich", async () => {
  const { store, state } = await setup();
  const [a, b] = state.items;
  await store.addAnnotation("t", { itemId: a!.id, rect: [10, 10, 50, 50], note: "Kopf", source: "text" });
  const wide = path.join(path.dirname(a!.path), "a2.png");
  await sharp({ create: { width: 800, height: 300, channels: 3, background: "#808080" } }).png().toFile(wide);
  const origin = { kind: "figma" as const, ref: "https://www.figma.com/design/ABC/Datei?node-id=1-2" };
  const after = await store.open("t", { images: [{ path: wide, origin, replaces: a!.id }] });
  const swapped = after.items.find((i) => i.id === a!.id)!;
  assert.equal(after.items.length, 3);
  assert.equal(swapped.path, wide);
  assert.equal(swapped.imageWidth, 800);
  assert.equal(swapped.title, a!.title);
  assert.equal(swapped.origin?.ref, origin.ref);
  assert.equal(swapped.x, a!.x);
  assert.equal(after.annotations.length, 1);
  assert.deepEqual(after.groups[0]!.itemIds, [a!.id, b!.id]);
  assert.equal(after.items.find((i) => i.id === b!.id)!.x, a!.x + 800 + 200, "Reihe rückt nach");
  await assert.rejects(store.open("t", { images: [{ path: wide, replaces: "gibtsnicht" }] }), /replaces/);
});

test("Fassungen: Tauschen legt die alte Fassung auf den Stapel, dieselbe Datei nicht; bleibt in der Datei", async () => {
  const { store, state, dir } = await setup();
  const [a] = state.items;
  const v2 = path.join(dir, "a-v2.png");
  const v3 = path.join(dir, "a-v3.png");
  for (const f of [v2, v3]) await sharp({ create: { width: 500, height: 300, channels: 3, background: "#707070" } }).png().toFile(f);
  await store.open("t", { images: [{ path: v2, replaces: a!.id, meta: { fassung: 2 } }] });
  await store.open("t", { images: [{ path: v2, replaces: a!.id }] });
  const after = await store.open("t", { images: [{ path: v3, replaces: a!.id, meta: { fassung: 3 } }] });
  const item = after.items.find((i) => i.id === a!.id)!;
  assert.equal(item.path, v3);
  assert.deepEqual(item.versions?.map((v) => path.basename(v.path)), ["a.png", "a-v2.png"], "älteste zuerst, dieselbe Datei kein zweites Mal");
  assert.deepEqual(item.versions?.[1]?.meta, { fassung: 2 });
  assert.equal(item.versions?.[0]?.imageWidth, 400);
  const again = await createCanvasStore({ dir: path.join(dir, "canvases") });
  assert.equal((await again.get("t"))!.items.find((i) => i.id === a!.id)!.versions?.length, 2);
  assert.equal((await again.get("t"))!.items.find((i) => i.id !== a!.id)!.versions, undefined);
});

test("Erledigt: Claude mit Antwort über Nummer oder id, von Hand ohne Antwort, wieder offen; Unbekanntes ändert nichts", async () => {
  const { store, state, dir } = await setup();
  const [a] = state.items;
  for (const n of ["eins", "zwei", "drei"]) await store.addAnnotation("t", { itemId: a!.id, rect: [0, 0, 50, 50], note: n, source: "text" });
  const ids = (await store.get("t"))!.annotations.map((x) => x.id);
  await assert.rejects(store.resolveAnnotations("t", [{ ref: "1" }, { ref: "9" }]), /annotation 9/);
  assert.equal((await store.get("t"))!.annotations.filter((x) => x.done).length, 0);
  const { resolved } = await store.resolveAnnotations("t", [{ ref: "1", reply: "  Abstand verkleinert " }, { ref: ids[2]! }]);
  assert.deepEqual(resolved, [ids[0], ids[2]]);
  await store.updateAnnotation("t", ids[1]!, { done: { by: "user" } });
  await store.updateAnnotation("t", ids[2]!, { done: null });
  const again = await createCanvasStore({ dir: path.join(dir, "canvases") });
  const notes = (await again.get("t"))!.annotations;
  assert.equal(notes.length, 3, "erledigt heißt nicht entfernt");
  assert.deepEqual(notes.map((x) => x.done?.by ?? null), ["claude", "user", null]);
  assert.equal(notes[0]!.done?.reply, "Abstand verkleinert");
  const summary = (await again.list()).find((c) => c.name === "t")!;
  assert.deepEqual([summary.annotations, summary.done], [1, 2]);
});

test("Punkt: Anmerkung ohne Fläche bleibt ein Punkt", async () => {
  const { store, state } = await setup();
  const [a] = state.items;
  const p = await store.addAnnotation("t", { itemId: a!.id, rect: [120.4, 80.6, 0, 0], note: "hier", source: "text" });
  assert.deepEqual(p.rect, [120, 81, 0, 0]);
});

test("Claude entfernt Anmerkungen über Nummer oder id, Nummern vor dem Entfernen; Unbekanntes entfernt nichts", async () => {
  const { store, state, dir } = await setup();
  const [a] = state.items;
  for (const n of ["eins", "zwei", "drei", "vier"]) await store.addAnnotation("t", { itemId: a!.id, rect: [0, 0, 50, 50], note: n, source: "text" });
  const ids = (await store.get("t"))!.annotations.map((x) => x.id);
  const { removed } = await store.removeAnnotations("t", ["1", "3", ids[3]!]);
  assert.equal(removed.length, 3);
  const again = await createCanvasStore({ dir: path.join(dir, "canvases") });
  assert.deepEqual((await again.get("t"))!.annotations.map((x) => x.note), ["zwei"]);
  await assert.rejects(again.removeAnnotations("t", ["1", "9"]), /annotation 9/);
  assert.equal((await again.get("t"))!.annotations.length, 1);
});

test("Claude entfernt Bilder und Gruppen; die Reihe rückt zusammen; Unbekanntes entfernt nichts", async () => {
  const { store, state } = await setup();
  const [a, b, c] = state.items;
  await store.addAnnotation("t", { itemId: a!.id, rect: [0, 0, 50, 50], note: "weg mit a", source: "text" });
  await assert.rejects(store.remove("t", { images: ["1"], groups: ["Gibtsnicht"] }), /Gruppe Gibtsnicht/);
  assert.equal((await store.get("t"))!.items.length, 3, "nichts entfernt");
  const { removed, state: after } = await store.remove("t", { images: ["1"] });
  assert.deepEqual(removed, [a!.id]);
  assert.equal(after.annotations.length, 0, "Anmerkungen gehen mit");
  assert.deepEqual(after.groups[0]!.itemIds, [b!.id]);
  assert.equal(after.items.find((i) => i.id === b!.id)!.x, a!.x, "Reihe rückt zusammen");
  const gone = await store.remove("t", { groups: ["folien"] });
  assert.deepEqual(gone.groups, ["Folien"]);
  assert.deepEqual(gone.state.items.map((i) => i.id), [c!.id]);
  assert.deepEqual(gone.state.groups, []);
});

test("meta: freie Angaben je Bild, bleiben in der Datei; Tauschen ersetzt oder behält sie; zu groß oder kein Objekt wird abgelehnt", async () => {
  const { store, state, dir } = await setup();
  const [a] = state.items;
  const d = path.join(dir, "d.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#808080" } }).png().toFile(d);
  await store.open("t", { images: [{ path: d, meta: { fassung: 1, projekt: "plakat" } }] });
  const reopened = await createCanvasStore({ dir: path.join(dir, "canvases") });
  const item = (await reopened.get("t"))!.items.find((i) => i.path === d)!;
  assert.deepEqual(item.meta, { fassung: 1, projekt: "plakat" });
  // Gleicher Pfad: nur die Angaben neu.
  const same = await reopened.open("t", { images: [{ path: d, meta: { fassung: 1, geprüft: true } }] });
  assert.equal(same.items.length, 4);
  assert.deepEqual(same.items.find((i) => i.path === d)!.meta, { fassung: 1, geprüft: true });
  // Tauschen ohne meta behält, mit meta ersetzt.
  const e = path.join(dir, "e.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#808080" } }).png().toFile(e);
  const kept = await reopened.open("t", { images: [{ path: e, replaces: item.id }] });
  assert.deepEqual(kept.items.find((i) => i.id === item.id)!.meta, { fassung: 1, geprüft: true });
  const replaced = await reopened.open("t", { images: [{ path: d, replaces: item.id, meta: { fassung: 2 } }] });
  assert.deepEqual(replaced.items.find((i) => i.id === item.id)!.meta, { fassung: 2 });
  assert.equal(replaced.items.find((i) => i.id === a!.id)!.meta, undefined);
  await assert.rejects(reopened.open("t", { images: [{ path: d, meta: { text: "x".repeat(2100) } }] }), /at most 2000/);
  await assert.rejects(reopened.open("t", { images: [{ path: d, meta: [1, 2] as unknown as Record<string, unknown> }] }), /JSON object/);
});
