// Vertragsprüfung: preload.cjs gibt genau die Kanäle frei, die ipc.ts nennt.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EVENTS, INVOKE } from "./ipc.ts";

const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const listIn = (name: string) => {
  const m = preload.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(m, `${name} fehlt in preload.cjs`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
};

test("preload gibt genau die Kanäle aus ipc.ts frei", () => {
  assert.deepEqual(listIn("INVOKE"), Object.values(INVOKE).sort());
  assert.deepEqual(listIn("EVENTS"), Object.values(EVENTS).sort());
});
