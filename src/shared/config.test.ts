import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adoptFormerData } from "./config.ts";

const support = (home: string, name: string) => path.join(home, "Library/Application Support", name);

test("Datenordner unter altem Namen wird übernommen, der alte Ort verweist darauf", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
  fs.mkdirSync(path.join(support(home, "Canvas"), "canvases"), { recursive: true });
  fs.writeFileSync(path.join(support(home, "Canvas"), "canvases/a.canvas"), "{}");
  assert.equal(adoptFormerData(home, "Sideview", ["Canvas"]), support(home, "Canvas"));
  assert.ok(fs.existsSync(path.join(support(home, "Sideview"), "canvases/a.canvas")));
  assert.ok(fs.lstatSync(support(home, "Canvas")).isSymbolicLink());
  // Alte absolute Pfade gehen weiter.
  assert.equal(fs.readFileSync(path.join(support(home, "Canvas"), "canvases/a.canvas"), "utf8"), "{}");
  // Zweiter Aufruf (etwa vom MCP-Server) ändert nichts.
  assert.equal(adoptFormerData(home, "Sideview", ["Canvas"]), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test("Gibt es den neuen Ordner schon oder keinen alten, bleibt alles, wie es ist", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
  assert.equal(adoptFormerData(home, "Sideview", ["Canvas"]), null);
  fs.mkdirSync(support(home, "Canvas"), { recursive: true });
  fs.mkdirSync(support(home, "Sideview"), { recursive: true });
  assert.equal(adoptFormerData(home, "Sideview", ["Canvas"]), null);
  assert.ok(fs.lstatSync(support(home, "Canvas")).isDirectory());
  fs.rmSync(home, { recursive: true, force: true });
});
