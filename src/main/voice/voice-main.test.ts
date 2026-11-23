import { test } from "node:test";
import assert from "node:assert/strict";
import { whisperPrompt } from "./glossary.ts";
import { collapseRepeats } from "./transcribe.ts";

test("Whisper-Wiederholungen fallen weg", () => {
  assert.equal(collapseRepeats("Den Kopf besprechen. Den Kopf besprechen. Den Kopf besprechen."), "Den Kopf besprechen.");
  assert.equal(collapseRepeats("Zeig mir die Pfannen. Zeig mir die Pfannen"), "Zeig mir die Pfannen.");
  assert.equal(collapseRepeats("Das Logo ist zu klein. Die Zeile ist zu dicht."), "Das Logo ist zu klein. Die Zeile ist zu dicht.");
});

test("Prompt bleibt kurz, gleichnamige Bereiche einmal", () => {
  const visible = Array.from({ length: 24 }, (_, i) => `Abschnitt Nummer ${i % 12} mit langem Titel (${i < 12 ? "Desktop" : "Handy"})`);
  const p = whisperPrompt(["RAG", "Jev", "MCP"], ["Kopf (Desktop)", "Kopf (Handy)", ...visible]);
  assert.ok(p.length <= 600, `zu lang: ${p.length}`);
  assert.equal(p.match(/Kopf/g)?.length, 1);
  assert.ok(p.startsWith("Fachbegriffe: RAG, Jev, MCP."));
});

test("Kev, wie Whisper es schreibt, wird zu Kev; andere Glossarwörter und Wortteile bleiben", async () => {
  const { aliasesOf, canonical } = await import("./glossary.ts");
  const aliases = aliasesOf([
    { term: "Kev", spoken: ["Kef", "Keff", "Kaev", "KV"], replace: true },
    { term: "Jev", spoken: ["Chef"] },
  ]);
  assert.equal(canonical("Nutzer, Kef.", aliases), "Nutzer, Kev.");
  assert.equal(canonical("Keff start.", aliases), "Kev start.");
  assert.equal(canonical("Suche mit Kaev.", aliases), "Suche mit Kev.");
  assert.equal(canonical("Suche mit KV", aliases), "Suche mit Kev");
  assert.equal(canonical("Der Chef sagt Kefir und Session", aliases), "Der Chef sagt Kefir und Session");
});
