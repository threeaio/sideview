import { test } from "node:test";
import assert from "node:assert/strict";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { CATALOGS, phrases, placeholders, t } from "./index.ts";
import type { Entry } from "./types.ts";

const kind = (e: Entry) => (Array.isArray(e) ? "phrases" : typeof e === "string" ? "text" : "plural");
const texts = (e: Entry): string[] => (Array.isArray(e) ? [...e] : typeof e === "string" ? [e] : [(e as { one: string }).one, (e as { other: string }).other]);

test("Kataloge: jeder Schlüssel in beiden Sprachen, gleiche Art, gleiche Platzhalter", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
  for (const key of Object.keys(de) as (keyof typeof de)[]) {
    const a = de[key] as Entry;
    const b = en[key] as Entry;
    assert.equal(kind(b), kind(a), key);
    const ph = (e: Entry) => [...new Set(texts(e).flatMap(placeholders))].sort();
    assert.deepEqual(ph(b), ph(a), `Platzhalter in ${key}`);
    for (const s of texts(b)) assert.ok(s.trim().length > 0, `leer: ${key}`);
  }
});

test("Kataloge: Phrasen sind schon klein geschrieben", () => {
  for (const catalog of Object.values(CATALOGS))
    for (const [key, value] of Object.entries(catalog)) if (Array.isArray(value)) for (const p of value) assert.equal(p, p.toLowerCase(), `${key}: ${p}`);
});

test("t: Text, Platzhalter, Einzahl und Mehrzahl", () => {
  assert.equal(t("de", "review.finish"), "Fertig");
  assert.equal(t("en", "review.finish"), "Done");
  assert.equal(t("de", "history.annotationDeleted", { n: 2 }), "Anmerkung 2 gelöscht");
  assert.equal(t("en", "history.groupDeleted", { name: "Heads" }), "Group “Heads” deleted");
  assert.equal(t("de", "count.annotations", { count: 1 }), "1 Anmerkung");
  assert.equal(t("de", "count.annotations", { count: 3 }), "3 Anmerkungen");
  assert.equal(t("en", "count.images", { count: 1 }), "1 image");
  assert.equal(t("en", "count.images", { count: 0 }), "0 images");
  // Fehlt ein Wert, bleibt der Platzhalter stehen statt still zu verschwinden.
  assert.equal(t("en", "notes.all"), "All {count}");
});

test("phrases: ausgefüllt, normalisiert, ohne Doppelte", () => {
  assert.deepEqual(phrases("en", "cmd.finish.phrases"), ["done", "i m done", "finished", "send it", "send it to claude", "that s it"]);
  assert.deepEqual(phrases("de", "cmd.group.phrases", { name: "mostly air" }), ["mostly air", "gruppe mostly air"]);
  assert.deepEqual(phrases("de", "cmd.imageNotes.phrases", { name: "heise.de", short: "heise" }), ["anmerkungen zu heise de", "anmerkungen heise de", "anmerkungen zu heise"]);
  assert.deepEqual(phrases("en", "cmd.annotation.phrases", { w: "three" }), ["note three", "number three", "annotation three"]);
});
