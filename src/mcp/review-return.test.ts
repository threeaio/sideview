// sideview_review for MCP clients without progress notifications (many give up after 60 s): it returns "still open"
// early, the review stays open, and the next call continues it. With progress notifications it keeps waiting.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stagePageShots } from "../../test/fixtures/stage.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = "4727";

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

let tmp = "";
let app: Awaited<ReturnType<typeof import("../main/serve.ts").startApp>>;
let client: Client;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-return-"));
  const { desktop } = await stagePageShots(path.join(tmp, "shots", "fixture-page"));
  process.env.CANVAS_DATA = tmp;
  process.env.CANVAS_PORT = PORT;
  const { startApp } = await import("../main/serve.ts");
  app = await startApp({ port: Number(PORT) });
  await app.store.open("plain", { images: [{ path: desktop }] });
  client = new Client({ name: "plain-client", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "src/mcp/server.ts")],
      env: { ...(process.env as Record<string, string>), CANVAS_DATA: tmp, CANVAS_PORT: PORT, CANVAS_REVIEW_RETURN_MS: "400" },
    }),
  );
});

after(async () => {
  await client?.close();
  app?.server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const finish = async (canvas: string) => {
  const s = (await app.store.get(canvas))!;
  return app.reviews.finish(canvas, { canvas, finishedAt: "2026-11-23T02:00:00.000Z", annotations: s.annotations, items: s.items, groups: s.groups });
};
const textOf = (r: ToolResult) => r.content[0]?.text ?? "";

test("without progress: returns early, the review stays open, the next call gets the result", async () => {
  const t0 = Date.now();
  const first = (await client.callTool({ name: "sideview_review", arguments: { canvas: "plain" } })) as ToolResult;
  assert.match(textOf(first), /still open/);
  assert.ok(Date.now() - t0 < 5_000, "returns well before 60 s");
  assert.equal(app.reviews.open().length, 1, "the review is still open in the app");
  // The user clicks "Done" while no call is waiting.
  assert.equal((await finish("plain")).length, 1);
  const second = (await client.callTool({ name: "sideview_review", arguments: { canvas: "plain" } })) as ToolResult;
  assert.match(textOf(second), /The user said "Done"/);
  assert.equal(app.reviews.open().length, 0);
});

test("with progress notifications: keeps waiting past the early return", async () => {
  const progress: string[] = [];
  const pending = client.callTool({ name: "sideview_review", arguments: { canvas: "plain" } }, undefined, {
    onprogress: (p) => progress.push(String(p.message)),
    resetTimeoutOnProgress: true,
  }) as Promise<ToolResult>;
  await new Promise((r) => setTimeout(r, 1_200));
  assert.equal(app.reviews.open().length, 1, "still waiting after three times the early-return limit");
  await finish("plain");
  assert.match(textOf(await pending), /The user said "Done"/);
});
