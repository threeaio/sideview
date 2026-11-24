import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDictation, decideFromJev, normalize, numberWords, routeInCode, spokenNumber, stripSaveWord, type VoiceContext, type VoiceOption } from "./voice.ts";

const opt = (id: string, phrases: string[], extra: Partial<VoiceOption> = {}): VoiceOption => ({ id, meaning: id, label: id, phrases, ...extra });
const options = [
  opt("uebersicht", ["übersicht", "alles zeigen"]),
  opt("bereich-0-0", ["kopf", "oben"]),
  opt("bereich-1-0", ["kopf", "oben"]),
  opt("bereich-0-1", ["pfannen"]),
  opt("fertig", ["fertig", "abschicken"], { whileDictating: true }),
  opt("sichern", ["sichern", "speichern"], { whileDictating: true }),
];
const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({ screen: "", state: {}, options, dictating: false, pending: null, ...over });

test("normalize: klein, ohne Satzzeichen", () => {
  assert.equal(normalize("  Fertig. "), "fertig");
  assert.equal(normalize("„Zeig mir – die Pfannen!“"), "zeig mir die pfannen");
});

test("Code: genaues Wort, Wort im kurzen Satz", () => {
  assert.deepEqual(routeInCode("Übersicht.", ctx()), { kind: "command", id: "uebersicht", stage: "code" });
  assert.deepEqual(routeInCode("Zeig mir die Pfannen", ctx()), { kind: "command", id: "bereich-0-1", stage: "code" });
});

test("Code: zweimal derselbe Name geht an Jev", () => {
  assert.deepEqual(routeInCode("Kopf", ctx()), { kind: "jev", namesakes: ["bereich-0-0", "bereich-1-0"] });
  assert.deepEqual(routeInCode("den Kopf besprechen", ctx()), { kind: "jev", namesakes: ["bereich-0-0", "bereich-1-0"] });
});

test("Code: gleichnamige Ziele, eines im Blick", () => {
  const c = ctx({ options: options.map((o) => (o.id === "bereich-1-0" ? { ...o, preferred: true } : o)) });
  assert.deepEqual(routeInCode("den Kopf besprechen", c), { kind: "command", id: "bereich-1-0", stage: "code" });
});

test("Code: lange Sätze gehen an Jev, auch wenn ein Name vorkommt", () => {
  assert.deepEqual(routeInCode("ich glaube die pfannen sind noch nicht so gut gelöst", ctx()), { kind: "jev", namesakes: [] });
});

test("Diktat: lange Sätze werden Notiz, genaue Befehle fürs Notizfeld gelten", () => {
  assert.deepEqual(routeInCode("Das runde Foto wirkt aufgeklebt.", ctx({ dictating: true })), { kind: "dictation", text: "Das runde Foto wirkt aufgeklebt." });
  // Kurz und kein Befehl fürs Notizfeld: Jev entscheidet zwischen Befehl und Text.
  assert.deepEqual(routeInCode("Übersicht", ctx({ dictating: true })), { kind: "jev", namesakes: [], dictation: true });
  assert.deepEqual(routeInCode("Fertig.", ctx({ dictating: true })), { kind: "command", id: "fertig", stage: "code" });
  assert.deepEqual(routeInCode("ich bin fertig mit dem kopf", ctx({ dictating: true })).kind, "dictation");
});

test("Rückfrage: Nummer wählt den Kandidaten", () => {
  const c = ctx({ pending: ["bereich-0-0", "bereich-1-0"] });
  assert.deepEqual(routeInCode("Zwei.", c), { kind: "command", id: "bereich-1-0", stage: "number" });
  assert.deepEqual(routeInCode("die erste", c), { kind: "command", id: "bereich-0-0", stage: "number" });
  assert.equal(spokenNumber("Nummer 3"), 3);
  assert.equal(spokenNumber("das ist eine lange antwort mit eins"), null);
  assert.deepEqual(numberWords(2), ["2", "zwei"]);
});

test("Leer bleibt leer", () => {
  assert.deepEqual(routeInCode(" … ", ctx()), { kind: "none", reason: "empty" });
});

test("Jev: sicher, knapp, nichts", () => {
  assert.deepEqual(decideFromJev({ uebersicht: 0.9, none: 0.05 }, 0.9, options), { kind: "command", id: "uebersicht", stage: "jev", probability: 0.9 });
  assert.deepEqual(decideFromJev({ "bereich-0-0": 0.45, "bereich-1-0": 0.4, none: 0.1 }, 0.9, options), { kind: "ask", candidates: ["bereich-0-0", "bereich-1-0"] });
  assert.deepEqual(decideFromJev({ uebersicht: 0.2, none: 0.7 }, 0.2, options), { kind: "none", reason: "not_addressed" });
  assert.deepEqual(decideFromJev({ erfunden: 0.99 }, 0.9, options), { kind: "none", reason: "unclear" });
  // Gleichnamige Ziele und Jev unsicher: nachfragen, wahrscheinlichstes zuerst.
  assert.deepEqual(decideFromJev({ "bereich-1-0": 0.15, "bereich-0-0": 0.6, none: 0.1 }, 0.9, options, ["bereich-0-0", "bereich-1-0"]), { kind: "ask", candidates: ["bereich-0-0", "bereich-1-0"] });
  // Auch wenn Jev etwas Drittes vorne sieht: Das gesagte Wort passte auf genau diese zwei.
  assert.deepEqual(decideFromJev({ "bereich-0-1": 0.62, "bereich-0-0": 0.2, none: 0.1 }, 0.9, options, ["bereich-0-0", "bereich-1-0"]), { kind: "ask", candidates: ["bereich-0-0", "bereich-1-0"] });
  // Auch wenn Jev „nichts davon“ vorne sieht (23.11., „Zeig mir die Pfannen“ blieb 1 von 4 Mal ohne Rückfrage).
  assert.deepEqual(decideFromJev({ "bereich-1-0": 0.2, "bereich-0-0": 0.3, none: 0.5 }, 0.9, options, ["bereich-0-0", "bereich-1-0"]), { kind: "ask", candidates: ["bereich-0-0", "bereich-1-0"] });
  // Nicht an die App gerichtet bleibt nicht gerichtet, auch mit passendem Wort.
  assert.deepEqual(decideFromJev({ "bereich-0-0": 0.1, none: 0.8 }, 0.2, options, ["bereich-0-0", "bereich-1-0"]), { kind: "none", reason: "not_addressed" });
});

test("Diktat: kurze Hörfehler eines Befehls zählen als Befehl, Sätze nicht", () => {
  const sichern = { id: "sichern", meaning: "Save the note.", phrases: ["sichern", "speichern", "schließen"], whileDictating: true, label: "Gesichert" };
  const c = ctx({ dictating: true, options: [...options, sichern] });
  assert.deepEqual(routeInCode("Sicher.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Speicher.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Schließend.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Sichere.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Sicherung", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Sichern bitte.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Schließe.", c), { kind: "command", id: "sichern", stage: "code" });
  // Kurz, aber kein klarer Befehl: Jev fragt, ob Befehl oder Text. Lange Sätze sind immer Text.
  assert.deepEqual(routeInCode("Sicherheit", c), { kind: "jev", namesakes: [], dictation: true });
  assert.equal(routeInCode("Das runde Foto wirkt auf mich aufgeklebt.", c).kind, "dictation");
});

test("Diktat mit Jev: sicher ausführen, unsicher nachfragen, sonst Text", () => {
  const sichern = { id: "sichern", meaning: "Save the note.", phrases: ["sichern"], whileDictating: true, label: "Gesichert" };
  const opts = [...options, sichern];
  assert.deepEqual(decideDictation({ sichern: 0.9, diktat: 0.1 }, opts, "Sicher."), { kind: "command", id: "sichern", stage: "jev", probability: 0.9 });
  assert.deepEqual(decideDictation({ sichern: 0.4, diktat: 0.6 }, opts, "Sicher."), { kind: "ask", candidates: ["sichern"], dictation: "Sicher." });
  assert.deepEqual(decideDictation({ sichern: 0.05, diktat: 0.95 }, opts, "Gut so."), { kind: "dictation", text: "Gut so." });
});

test("Schlüsselwort am Ende: Rest wird Notiz und gesichert", () => {
  const words = ["Ablage"];
  assert.equal(stripSaveWord("Der Kopf ist zu groß, Ablage.", words), "Der Kopf ist zu groß");
  assert.equal(stripSaveWord("Der Kopf ist zu groß. ablage", words), "Der Kopf ist zu groß.");
  assert.equal(stripSaveWord("Ablage.", words), "");
  // Whisper hört ein wenig anders
  assert.equal(stripSaveWord("Schrift zu klein. Ablagen.", words), "Schrift zu klein.");
  // nur am Ende, und nicht zu weit weg
  assert.equal(stripSaveWord("Ablage ist hier zu voll", words), null);
  assert.equal(stripSaveWord("Der Abstand passt", words), null);
  // mehrere Wörter
  assert.equal(stripSaveWord("Zu eng. Notiz Ende.", ["Notiz Ende"]), "Zu eng.");
  assert.deepEqual(routeInCode("Zu eng, Ablage.", ctx({ dictating: true }), words), { kind: "dictation", text: "Zu eng", save: true });
  assert.deepEqual(routeInCode("Ablage", ctx({ dictating: true }), words), { kind: "dictation", text: "", save: true });
  // ohne offenes Notizfeld ist das Wort nichts Besonderes
  assert.notEqual(routeInCode("Ablage", ctx(), words).kind, "dictation");
});

test("Diktat: Notiz und „sichern“ in einer Äußerung, ohne eigenes Schlüsselwort (Log 22.11.)", () => {
  // 22.11.: „Meine Anweisungen sind immer nur ein Wort und dann sage ich sichern dahinter.“
  const sichern = { id: "sichern", meaning: "Save the note.", phrases: ["sichern", "speichern", "schließen", "ok", "passt"], whileDictating: true, label: "Gesichert" };
  const c = ctx({ dictating: true, options: [...options, sichern] });
  const saved = (text: string) => ({ kind: "dictation", text, save: true });
  assert.deepEqual(routeInCode("Kurz sichern.", c), saved("Kurz"));
  assert.deepEqual(routeInCode("Kurz, sicher.", c), saved("Kurz"));
  assert.deepEqual(routeInCode("KURZ SICHERN.", c), saved("KURZ"));
  assert.deepEqual(routeInCode("Fahrt sicher.", c), saved("Fahrt"));
  assert.deepEqual(routeInCode("Fahnt sichern.", c), saved("Fahnt"));
  assert.deepEqual(routeInCode("Kurz oder Fahrt sichern.", c), saved("Kurz oder Fahrt"));
  assert.deepEqual(routeInCode("Zu eng, speichern.", c), saved("Zu eng"));
  // Whisper schreibt es zusammen
  assert.deepEqual(routeInCode("Fahrtsichern.", c), saved("Fahrt"));
  assert.deepEqual(routeInCode("Kurz oder Fahrtsichern.", c), saved("Kurz oder Fahrt"));
  // „sichern“ allein bleibt der Befehl, ebenso mit „bitte“ dahinter
  assert.deepEqual(routeInCode("sichern.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Sicher.", c), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Sichern bitte.", c), { kind: "command", id: "sichern", stage: "code" });
  // Wörter, die auf „sichern“ enden, sind keine Notiz mit Befehl
  assert.notDeepEqual(routeInCode("Versichern", c), saved("Ver"));
  assert.notDeepEqual(routeInCode("Absichern", c), saved("Ab"));
  // „passt“ oder „ok“ am Ende bleiben Text: „Der Abstand passt“ ist eine Notiz
  assert.notDeepEqual(routeInCode("Der Abstand passt", c), saved("Der Abstand"));
});

const en = (over: Partial<VoiceContext> = {}): VoiceContext => ctx({ language: "en", ...over });
const enOptions = [
  opt("uebersicht", ["overview", "show everything"]),
  opt("naechstes-bild", ["next", "next image"]),
  opt("fertig", ["done", "finished", "send it"], { whileDictating: true }),
  opt("sichern", ["save", "save it", "ok", "okay", "close"], { whileDictating: true }),
  opt("verwerfen", ["discard", "cancel"], { whileDictating: true }),
];

test("Englisch: Zahlwörter bis zwanzig, Ordnungszahlen, Rückfrage", () => {
  assert.deepEqual(numberWords(3, "en"), ["3", "three"]);
  assert.deepEqual(numberWords(20, "en"), ["20", "twenty"]);
  assert.deepEqual(numberWords(21, "en"), ["21"]);
  assert.equal(spokenNumber("Two.", "en"), 2);
  assert.equal(spokenNumber("the second one", "en"), 2);
  assert.equal(spokenNumber("Number 3", "en"), 3);
  assert.equal(spokenNumber("zwei", "en"), null);
  assert.equal(spokenNumber("two", "de"), null);
  const c = en({ options: enOptions, pending: ["bereich-0-0", "bereich-1-0"] });
  assert.deepEqual(routeInCode("Two.", c), { kind: "command", id: "bereich-1-0", stage: "number" });
  assert.deepEqual(routeInCode("The first one", c), { kind: "command", id: "bereich-0-0", stage: "number" });
});

test("Englisch: Befehle im Code, „done“ auch beim Diktat", () => {
  const c = en({ options: enOptions });
  assert.deepEqual(routeInCode("Overview.", c), { kind: "command", id: "uebersicht", stage: "code" });
  assert.deepEqual(routeInCode("Next.", c), { kind: "command", id: "naechstes-bild", stage: "code" });
  assert.deepEqual(routeInCode("Done.", c), { kind: "command", id: "fertig", stage: "code" });
  assert.deepEqual(routeInCode("Done.", en({ options: enOptions, dictating: true })), { kind: "command", id: "fertig", stage: "code" });
  assert.deepEqual(routeInCode("Save.", en({ options: enOptions, dictating: true })), { kind: "command", id: "sichern", stage: "code" });
  assert.deepEqual(routeInCode("Okay.", en({ options: enOptions, dictating: true })), { kind: "command", id: "sichern", stage: "code" });
});

test("Englisch: „save“ am Ende eines Diktats hängt an und sichert", () => {
  const c = en({ options: enOptions, dictating: true });
  const saved = (text: string) => ({ kind: "dictation", text, save: true });
  assert.deepEqual(routeInCode("The logo is too small, save.", c), saved("The logo is too small"));
  assert.deepEqual(routeInCode("Too tight. Save it.", c), saved("Too tight."));
  assert.deepEqual(routeInCode("Headline too big save", c), saved("Headline too big"));
  // Kurze Wörter, die nur ähnlich klingen, bleiben Text: „same“, „safe“, „have“ sind keine Befehle.
  assert.deepEqual(routeInCode("This button looks exactly the same as the other one", c), { kind: "dictation", text: "This button looks exactly the same as the other one" });
  assert.deepEqual(routeInCode("The colours here feel a little bit too safe", c).kind, "dictation");
  assert.notDeepEqual(routeInCode("Same here", c), { kind: "command", id: "sichern", stage: "code" });
  // Deutsche Sichern-Wörter gelten im Englischen nicht.
  assert.notDeepEqual(routeInCode("Too tight, sichern.", c), saved("Too tight"));
  // Eigenes Schlüsselwort gilt in beiden Sprachen.
  assert.deepEqual(routeInCode("Too tight, stash.", c, ["stash"]), saved("Too tight"));
});

test("Fassungsvergleich: „weiter zurück“ blättert, schließt nicht (23.11.)", async () => {
  const { de } = await import("./i18n/de.ts");
  const { en } = await import("./i18n/en.ts");
  for (const [dict, cases] of [
    [de, { "weiter zurück": "aeltere-fassung", "zurück": "aeltere-fassung", "noch weiter zurück": "aeltere-fassung", "weiter vor": "neuere-fassung", "nächste fassung": "neuere-fassung", "zurück zum canvas": "vergleich-schliessen", "schließen": "vergleich-schliessen", "weiter runter": "vergleich-runter", "nach oben": "vergleich-hoch", "weiter weg": "vergleich-weiter-weg", "näher": "vergleich-naeher" }],
    [en, { "further back": "aeltere-fassung", "back": "aeltere-fassung", "back to the canvas": "vergleich-schliessen", "scroll down": "vergleich-runter", "up": "vergleich-hoch" }],
  ] as const) {
    const d = dict as Record<string, unknown>;
    const p = (key: string) => d[`${key}.phrases`] as string[];
    const compare = [
      opt("vergleich-schliessen", p("cmd.compareClose")),
      opt("aeltere-fassung", p("cmd.compareOlder")),
      opt("neuere-fassung", p("cmd.compareNewer")),
      opt("vergleich-anfang", p("cmd.overview")),
      opt("vergleich-naeher", p("cmd.zoomIn")),
      opt("vergleich-weiter-weg", p("cmd.zoomOut")),
      opt("vergleich-runter", p("cmd.compareDown")),
      opt("vergleich-hoch", p("cmd.compareUp")),
    ];
    for (const [said, id] of Object.entries(cases)) {
      assert.deepEqual(routeInCode(said, ctx({ options: compare })), { kind: "command", id, stage: "code" }, said);
    }
  }
});

test("Canvas und Vergleich: jede Phrase führt zu ihrem eigenen Befehl, auch Schwenken, Fassung per Nummer, Umbenennen (24.11.)", async () => {
  const { de } = await import("./i18n/de.ts");
  const { en } = await import("./i18n/en.ts");
  for (const [lang, dict] of [["de", de], ["en", en]] as const) {
    const d = dict as Record<string, unknown>;
    const fill = (key: string, vars: Record<string, string>) => (d[`${key}.phrases`] as string[]).map((p) => normalize(p.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")));
    const p = (key: string) => fill(key, {});
    const numbered = (id: string, key: string, n: number) => opt(`${id}-${n}`, numberWords(n, lang).flatMap((w) => fill(key, { w })));
    const always = ["selectTool", "markTool", "undo", "redo", "finish", "canvases", "newCanvas", "settings"].map((k) => opt(k, p(`cmd.${k}`)));
    const canvas = [
      ...always,
      ...["overview", "contents", "notes", "zoomIn", "zoomOut", "compare", "next", "previous", "groupImages", "ungroup"].map((k) => opt(k, p(`cmd.${k}`))),
      opt("runter", p("cmd.compareDown")),
      opt("hoch", p("cmd.compareUp")),
      opt("nach-links", p("cmd.panLeft")),
      opt("nach-rechts", p("cmd.panRight")),
      opt("gruppe-umbenennen", p("cmd.renameGroupHere")),
      opt("gruppe-umbenennen-0", fill("cmd.renameGroup", { name: "mostly air" })),
      opt("gruppe-0", fill("cmd.group", { name: "mostly air" })),
      ...[1, 2, 3].map((n) => numbered("anmerkung", "cmd.annotation", n)),
    ];
    const compare = [
      ...always,
      ...["compareClose", "compareOlder", "compareNewer", "compareDelete", "compareDown", "compareUp", "overview", "zoomIn", "zoomOut"].map((k) => opt(k, p(`cmd.${k}`))),
      ...[1, 2].map((n) => numbered("fassung", "cmd.compareVersion", n)),
      ...[1, 2, 3].map((n) => numbered("anmerkung", "cmd.annotation", n)),
      opt("bereich-0", ["header", "kopf"]),
    ];
    for (const options of [canvas, compare])
      for (const o of options)
        for (const said of o.phrases) assert.deepEqual(routeInCode(said, ctx({ options })), { kind: "command", id: o.id, stage: "code" }, `${lang}: „${said}“`);
  }
});
