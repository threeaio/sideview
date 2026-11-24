// Ganzer Weg ohne Fenster: MCP-Server als Kindprozess, Schnittstelle der App im Testprozess.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DESKTOP_SIZE, stagePageShots } from "../../test/fixtures/stage.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = "4729";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: ({ type: string } & Partial<TextContent>)[]; isError?: boolean };

let tmp = "";
let DESKTOP = "";
let app: Awaited<ReturnType<typeof import("../main/serve.ts").startApp>>;
let client: Client;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-test-"));
  // A page-shots fixture outside the data folder: regions and origin come from regions.json next to the image.
  ({ desktop: DESKTOP } = await stagePageShots(path.join(tmp, "shots", "fixture-page")));
  process.env.CANVAS_DATA = tmp;
  process.env.CANVAS_PORT = PORT;
  const { startApp } = await import("../main/serve.ts");
  app = await startApp({ port: Number(PORT) });
  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "src/mcp/server.ts")],
      env: { ...(process.env as Record<string, string>), CANVAS_DATA: tmp, CANVAS_PORT: PORT },
    }),
  );
});

after(async () => {
  await client?.close();
  app?.server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>;

test("sideview_open places the page-shots fixture with its regions", async () => {
  const res = await call("sideview_open", { images: [DESKTOP], title: "Lauf 20", focus: "Kopf" });
  const text = res.content[0]?.text ?? "";
  assert.equal(res.isError, undefined, text);
  assert.match(text, /Canvas "Lauf 20" \(name: lauf-20\) is open, zoomed to "Kopf"/);
  assert.match(text, new RegExp(`${DESKTOP_SIZE.width} × ${DESKTOP_SIZE.height} px`));
  assert.match(text, /Regions: Kopf \| Roasted on Monday, at your door by Thursday \| How it works \| Pick a plan \| Questions \| Fuß\./);
});

test("sideview_review waits for \"Done\", returns the annotation as text and asks for a short confirmation", async () => {
  const state = (await app.store.get("lauf-20"))!;
  await app.store.addAnnotation("lauf-20", { itemId: state.items[0]!.id, rect: [40, 20, 300, 120], note: "Logo zu klein", source: "voice" });
  const pending = call("sideview_review", { canvas: "lauf-20", prompt: "Passt der Kopf?" });
  for (let i = 0; i < 100 && app.reviews.open().length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.reviews.open()[0]?.prompt, "Passt der Kopf?");
  const now = (await app.store.get("lauf-20"))!;
  app.reviews.finish("lauf-20", { canvas: "lauf-20", finishedAt: "2026-11-04T18:00:00.000Z", annotations: now.annotations, items: now.items, groups: now.groups });
  const res = await pending;
  const text = res.content[0]?.text ?? "";
  assert.match(text, /1\. \(id \w+\) fixture\.example Desktop \(id \w+\), region "Kopf", in the image x 40, y 20, 300 × 120 px, on the canvas x -?\d+, y -?\d+, \d+ × \d+: "Logo zu klein"/);
  assert.match(text, /first write the user one short sentence: that their annotation has arrived/);
  assert.equal(res.content.length, 1, "text only at first, Claude fetches the crops afterwards");
});

test("sideview_review with now: true takes the annotations without \"Done\" and ends a waiting review (24.11.)", async () => {
  const waiting = call("sideview_review", { canvas: "lauf-20" });
  for (let i = 0; i < 100 && app.reviews.open().length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.reviews.open().length, 1);
  const res = await call("sideview_review", { canvas: "lauf-20", now: true });
  const text = res.content[0]?.text ?? "";
  assert.match(text, /^Taken from the canvas without "Done", as the user asked/);
  assert.match(text, /"Logo zu klein"/);
  assert.equal(app.reviews.open().length, 0, "the review in the app is finished too");
  assert.match((await waiting).content[0]?.text ?? "", /The user said "Done"/);
});

test("sideview_get returns everything: images with position, origin and regions, annotations, image and crops; sideview_list the summary", async () => {
  const got = await call("sideview_get", { canvas: "Lauf 20", images: true });
  const text = got.content[0]?.text ?? "";
  assert.match(text, /1 open annotation \(rectangles in image pixels, points without area\)/);
  assert.match(text, /1\. fixture\.example Desktop \(id \w+\)\n {3}File .*desktop\.png, 1440 × 6000 px, scale \d/);
  assert.match(text, /On the canvas: x -?\d+, y -?\d+, \d+ × \d+\n/);
  assert.match(text, /Origin: Website https:\/\/fixture\.example\/ \("desktop"\), fetched 20\d\d-/);
  assert.match(text, /Regions: Kopf \[x 0, y 0, 1440 × 820 px\]/);
  assert.deepEqual(got.content.map((c) => c.type), ["text", "image", "image"], "first the whole image, then the crop");
  const list = await call("sideview_list", {});
  assert.match(list.content[0]?.text ?? "", /Lauf 20 \(name: lauf-20\): 1 image, 1 open annotation/);
});

test("sideview_resolve_annotations marks resolved with a reply; \"Done\" then returns only open ones", async () => {
  const wrong = await call("sideview_resolve_annotations", { canvas: "lauf-20", annotations: [{ ref: 7 }] });
  assert.equal(wrong.isError, true);
  const res = await call("sideview_resolve_annotations", { canvas: "Lauf 20", annotations: [{ ref: 1, reply: "Logo auf 64 px vergrößert" }] });
  const text = res.content[0]?.text ?? "";
  assert.equal(res.isError, undefined, text);
  assert.match(text, /^1 annotation resolved\. Now:\n0 open annotations, 1 resolved/);
  assert.match(text, /"Logo zu klein" – resolved 20\d\d-[^,]+, reply: "Logo auf 64 px vergrößert"/);
  const now = (await app.store.get("lauf-20"))!;
  assert.equal(now.annotations[0]!.done?.by, "claude");
  const pending = call("sideview_review", { canvas: "lauf-20" });
  for (let i = 0; i < 100 && app.reviews.open().length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  app.reviews.finish("lauf-20", { canvas: "lauf-20", finishedAt: "2026-11-22T18:00:00.000Z", annotations: now.annotations, items: now.items, groups: now.groups });
  const done = (await pending).content[0]?.text ?? "";
  assert.match(done, /0 open annotations, 1 resolved \(/);
  assert.doesNotMatch(done, /Logo zu klein/, "resolved ones not again");
  assert.match(done, /There are no open annotations/);
});

test("sideview_remove_annotations removes by number, a wrong number reports which one is missing", async () => {
  const wrong = await call("sideview_remove_annotations", { canvas: "lauf-20", annotations: [7] });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]?.text ?? "", /This annotation does not exist/);
  const res = await call("sideview_remove_annotations", { canvas: "Lauf 20", annotations: [1] });
  const text = res.content[0]?.text ?? "";
  assert.equal(res.isError, undefined, text);
  assert.match(text, /1 annotation removed\. Now:\nNo annotations\./);
  assert.equal((await app.store.get("lauf-20"))!.annotations.length, 0);
});

test("sideview_remove removes an image by number, unknown references remove nothing", async () => {
  const before = (await app.store.get("lauf-20"))!.items.length;
  const wrong = await call("sideview_remove", { canvas: "lauf-20", images: [1], groups: ["gibt es nicht"] });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]?.text ?? "", /nothing was removed/);
  assert.equal((await app.store.get("lauf-20"))!.items.length, before);
  const res = await call("sideview_remove", { canvas: "Lauf 20", images: [1] });
  const text = res.content[0]?.text ?? "";
  assert.equal(res.isError, undefined, text);
  assert.match(text, /^1 image removed\. Now:/);
  assert.equal((await app.store.get("lauf-20"))!.items.length, before - 1);
});

test("an unknown canvas reports an error with a code", async () => {
  const res = await call("sideview_review", { canvas: "gibt-es-nicht" });
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? "", /not_found/);
});

test("an https image without origin is rejected before anything is loaded", async () => {
  const res = await call("sideview_open", { canvas: "lauf-20", images: [{ source: "https://example.com/bild.png" }] });
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? "", /origin missing/);
});

test("sideview_open accepts `meta` per image, sideview_get returns it; too large meta is rejected", async () => {
  const res = await call("sideview_open", { canvas: "meta", images: [{ source: DESKTOP, meta: { fassung: 2, projekt: "kaffee" } }] });
  assert.equal(res.isError, undefined, res.content[0]?.text);
  const got = await call("sideview_get", { canvas: "meta" });
  assert.match(got.content[0]?.text ?? "", /\n {3}Meta: \{"fassung":2,"projekt":"kaffee"\}/);
  const big = await call("sideview_open", { canvas: "meta", images: [{ source: DESKTOP, meta: { t: "x".repeat(2100) } }] });
  assert.equal(big.isError, true);
});
