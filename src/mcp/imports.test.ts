import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImportError, extensionFor, importImage, isRemote } from "./imports.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const fakeFetch = (body: Buffer, type: string, status = 200) => (async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch;

test("nur https gilt als Adresse, Pfade nicht", () => {
  assert.ok(isRemote("https://www.figma.com/api/mcp/asset/x.png"));
  assert.ok(!isRemote("http://example.com/a.png"));
  assert.ok(!isRemote("/home/n/a.png"));
});

test("Endung aus dem Inhaltstyp, Nicht-Bilder abgelehnt", () => {
  assert.equal(extensionFor("image/png"), ".png");
  assert.equal(extensionFor("image/jpeg; charset=binary"), ".jpg");
  assert.equal(extensionFor("text/html"), null);
  assert.equal(extensionFor(null), null);
});

test("Bild wird unter seinem Hash abgelegt, zweimal derselbe Pfad", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-imports-"));
  const a = await importImage("https://x.test/a.png", dir, fakeFetch(PNG, "image/png"));
  const b = await importImage("https://x.test/other.png", dir, fakeFetch(PNG, "image/png"));
  assert.equal(a, b);
  assert.equal(path.extname(a), ".png");
  assert.deepEqual(await fs.readFile(a), PNG);
});

test("Fehler kommen als Code: kein https, kein Bild, HTTP-Fehler", async () => {
  const dir = os.tmpdir();
  await assert.rejects(importImage("http://x.test/a.png", dir), (e: ImportError) => e.code === "not_https");
  await assert.rejects(importImage("https://x.test/a", dir, fakeFetch(Buffer.from("<html>"), "text/html")), (e: ImportError) => e.code === "not_an_image");
  await assert.rejects(importImage("https://x.test/a.png", dir, fakeFetch(PNG, "image/png", 403)), (e: ImportError) => e.code === "fetch_failed");
});
