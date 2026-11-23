import { test } from "node:test";
import assert from "node:assert/strict";
import { contentsLine, matches, since } from "./format.ts";

test("Inhalt in einer Zeile", () => {
  assert.equal(contentsLine({ items: 0, annotations: 0 }), "Leer");
  assert.equal(contentsLine({ items: 1, annotations: 0 }), "1 Bild");
  assert.equal(contentsLine({ items: 3, annotations: 1 }), "3 Bilder · 1 Anmerkung");
});

test("seit wann, grob", () => {
  const now = new Date(2026, 10, 5, 23, 0);
  const at = (d: Date) => d.toISOString();
  assert.equal(since(at(new Date(2026, 10, 5, 22, 59, 40)), now), "gerade eben");
  assert.equal(since(at(new Date(2026, 10, 5, 22, 55)), now), "vor 5 Min.");
  assert.equal(since(at(new Date(2026, 10, 5, 20, 30)), now), "vor 2 Std.");
  assert.equal(since(at(new Date(2026, 10, 5, 9, 5)), now), "heute, 9:05");
  assert.equal(since(at(new Date(2026, 10, 4, 12, 0)), now), "gestern");
  assert.equal(since(at(new Date(2026, 10, 1, 12, 0)), now), "vor 4 Tagen");
  assert.equal(since(at(new Date(2026, 9, 20, 12, 0)), now), "20.10.2026");
});

test("Suche über Titel und Namen, Wort für Wort", () => {
  const c = { title: "Book of Shapes", name: "mostly-air" };
  assert.ok(matches(c, "book"));
  assert.ok(matches(c, "shapes air"));
  assert.ok(!matches(c, "heise"));
  assert.ok(matches(c, ""));
});

test("englisch", () => {
  const now = new Date(2026, 10, 5, 23, 0);
  const at = (d: Date) => d.toISOString();
  assert.equal(contentsLine({ items: 0, annotations: 0 }, "en"), "Empty");
  assert.equal(contentsLine({ items: 3, annotations: 1 }, "en"), "3 images · 1 note");
  assert.equal(since(at(new Date(2026, 10, 5, 22, 55)), now, "en"), "5 min ago");
  assert.equal(since(at(new Date(2026, 10, 5, 9, 5)), now, "en"), "today, 9:05 AM");
  assert.equal(since(at(new Date(2026, 10, 4, 12, 0)), now, "en"), "yesterday");
  assert.equal(since(at(new Date(2026, 9, 20, 12, 0)), now, "en"), "Oct 20, 2026");
});
