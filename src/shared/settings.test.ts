import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanBaseUrl, cleanKeyword, parseSettings, resolveLanguage, saveWords } from "./settings.ts";

test("Schlüsselwort: aufräumen, leer, zu lang, doppelt", () => {
  assert.deepEqual(cleanKeyword("  „Ablage.“ ", []), { word: "Ablage" });
  assert.deepEqual(cleanKeyword(" .. ", []), { error: "empty" });
  assert.deepEqual(cleanKeyword("eins zwei drei vier", []), { error: "too_long" });
  assert.deepEqual(cleanKeyword("ablage", [{ word: "Ablage", action: "save" }]), { error: "taken" });
});

test("Gespeicherte Datei tolerant lesen", () => {
  const empty = { language: "auto", decision: { baseUrl: "", model: "" } };
  assert.deepEqual(parseSettings(null), { keywords: [], ...empty });
  const s = parseSettings({ keywords: [{ word: "Ablage", action: "save" }, { word: "ablage", action: "save" }, { word: "x", action: "fliegen" }, 3], extra: 1 });
  assert.deepEqual(s, { keywords: [{ word: "Ablage", action: "save" }], ...empty });
  assert.deepEqual(saveWords(s), ["Ablage"]);
});

test("Sprache und Entscheidungsdienst: tolerant lesen, auto nach System auflösen", () => {
  const s = parseSettings({ language: "en", decision: { baseUrl: "http://127.0.0.1:8000/", model: "kev-latest" } });
  assert.equal(s.language, "en");
  assert.deepEqual(s.decision, { baseUrl: "http://127.0.0.1:8000", model: "kev-latest" });
  assert.deepEqual(parseSettings({ language: "fr", decision: { baseUrl: "ftp://x", model: "a b" } }).decision, { baseUrl: "", model: "" });
  assert.equal(parseSettings({ language: "fr" }).language, "auto");
  assert.equal(resolveLanguage("auto", ["de-DE", "en-US"]), "de");
  assert.equal(resolveLanguage("auto", ["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLanguage("auto", ["fr-FR"]), "en");
  assert.equal(resolveLanguage("de", ["en-US"]), "de");
  assert.equal(cleanBaseUrl("https://api.typesafe.ai/"), "https://api.typesafe.ai");
  assert.equal(cleanBaseUrl("nope"), null);
});
