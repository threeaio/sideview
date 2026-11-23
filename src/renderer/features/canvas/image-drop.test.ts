import { test } from "node:test";
import assert from "node:assert/strict";
import { dropLabel, isImageFile, isImageType } from "./image-drop.ts";

test("Bilder erkennt die Fläche an Typ oder Endung, andere Dateien nicht", () => {
  assert.ok(isImageType("image/PNG"));
  assert.ok(!isImageType("application/pdf"));
  assert.ok(isImageFile({ type: "", name: "Bildschirmfoto 2026-11-05.jpeg" }));
  assert.ok(!isImageFile({ type: "", name: "notizen.md" }));
  assert.ok(!isImageFile({ type: "image/svg+xml", name: "logo.svg" }));
});

test("Hinweis nennt die Zahl erst ab zwei Bildern", () => {
  assert.equal(dropLabel(1), "Bild hier ablegen");
  assert.equal(dropLabel(3), "3 Bilder hier ablegen");
  assert.equal(dropLabel(1, "en"), "Drop image here");
  assert.equal(dropLabel(3, "en"), "Drop 3 images here");
});
