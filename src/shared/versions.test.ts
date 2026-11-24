import assert from "node:assert/strict";
import { test } from "node:test";
import type { Annotation, ImageItem } from "./contracts.ts";
import { putVersions, takeVersions, versionIndexAt } from "./versions.ts";

const v = (n: number, replacedAt: string) => ({ path: `/p/v${n}.png`, title: `V${n}`, imageWidth: 100, imageHeight: 100, scale: 1, replacedAt });
const item: ImageItem = { id: "a", path: "/p/now.png", title: "Now", imageWidth: 100, imageHeight: 100, scale: 1, x: 0, y: 0, regions: [], versions: [v(1, "2026-11-21T10:00:00Z"), v(2, "2026-11-22T10:00:00Z"), v(3, "2026-11-23T10:00:00Z")] };
const note = (id: string, createdAt: string, itemId = "a"): Annotation => ({ id, itemId, rect: [0, 0, 10, 10], note: id, createdAt, source: "text" });
const notes = [note("auf-1", "2026-11-20T10:00:00Z"), note("auf-2", "2026-11-21T12:00:00Z"), note("auf-3", "2026-11-22T12:00:00Z"), note("jetzt", "2026-11-23T12:00:00Z"), note("anderes-bild", "2026-11-21T12:00:00Z", "b")];

test("Fassung einer Anmerkung nach ihrer Entstehung", () => {
  assert.equal(versionIndexAt("2026-11-20T10:00:00Z", item.versions!), 0);
  assert.equal(versionIndexAt("2026-11-22T12:00:00Z", item.versions!), 2);
  assert.equal(versionIndexAt("2026-11-24T12:00:00Z", item.versions!), 3);
});

test("Fassung löschen: nur sie und ihre Anmerkungen, die übrigen gehören weiter zu ihrer Fassung", () => {
  const { item: after, annotations, removed } = takeVersions(item, notes, [1]);
  assert.deepEqual(after.versions!.map((x) => x.title), ["V1", "V3"]);
  assert.deepEqual(annotations.map((a) => a.id), ["auf-1", "auf-3", "jetzt", "anderes-bild"]);
  assert.deepEqual(removed.annotations.map((a) => a.id), ["auf-2"]);
  // Die Anmerkung auf V3 bleibt bei V3, die aktuelle bei der aktuellen.
  assert.equal(versionIndexAt("2026-11-22T12:00:00Z", after.versions!), 1);
  assert.equal(versionIndexAt("2026-11-23T12:00:00Z", after.versions!), 2);
});

test("Rückgängig stellt Reihenfolge und Anmerkungen wieder her", () => {
  const taken = takeVersions(item, notes, [0, 2]);
  assert.deepEqual(taken.item.versions!.map((x) => x.title), ["V2"]);
  const back = putVersions(taken.item, taken.annotations, taken.removed);
  assert.deepEqual(back.item.versions!.map((x) => x.title), ["V1", "V2", "V3"]);
  assert.deepEqual(back.annotations.map((a) => a.id).sort(), notes.map((a) => a.id).sort());
});

test("letzte frühere Fassung gelöscht: kein leeres versions-Feld", () => {
  const one = { ...item, versions: [v(1, "2026-11-21T10:00:00Z")] };
  const { item: after } = takeVersions(one, [], [0]);
  assert.equal("versions" in after, false);
  assert.deepEqual(putVersions(after, [], takeVersions(one, [], [0]).removed).item.versions!.map((x) => x.title), ["V1"]);
});
