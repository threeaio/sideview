import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviews } from "./reviews.ts";
import type { ReviewResult } from "../shared/contracts.ts";

const result = (canvas: string): ReviewResult => ({ canvas, finishedAt: "2026-11-04T17:00:00.000Z", annotations: [], items: [], groups: [] });

test("Warten endet bei „Fertig“, nicht erst nach Ablauf", async () => {
  const reviews = createReviews();
  const id = reviews.start("lauf-20", "Passt der Kopf?");
  const t0 = Date.now();
  const waiting = reviews.wait(id, 5_000);
  setTimeout(() => reviews.finish("lauf-20", result("lauf-20")), 20);
  const status = await waiting;
  assert.equal(status?.status, "done");
  assert.ok(Date.now() - t0 < 1_000);
});

test("Warten ohne Ereignis kehrt nach Ablauf mit offenem Stand zurück", async () => {
  const reviews = createReviews();
  const id = reviews.start("a", null);
  assert.equal((await reviews.wait(id, 10))?.status, "open");
});

test("„Fertig“ trifft nur die eigene Fläche", () => {
  const reviews = createReviews();
  const a = reviews.start("a", null);
  const b = reviews.start("b", null);
  assert.deepEqual(reviews.finish("a", result("a")), [a]);
  assert.equal(reviews.get(b)?.status, "open");
  assert.equal(reviews.open().length, 1);
});

test("Abbruch beendet das Warten mit Grund", async () => {
  const reviews = createReviews();
  const id = reviews.start("a", null);
  const waiting = reviews.wait(id, 5_000);
  assert.equal(reviews.cancel(id, "claude_aborted"), true);
  const status = await waiting;
  assert.equal(status?.status === "cancelled" && status.reason, "claude_aborted");
  assert.equal(reviews.cancel(id, "claude_aborted"), false);
});

test("Erledigte Besprechungen verschwinden nach der Frist", () => {
  let t = 0;
  const reviews = createReviews({ keepMs: 100, now: () => t });
  const id = reviews.start("a", null);
  reviews.finish("a", result("a"));
  t = 200;
  reviews.start("b", null); // räumt auf
  assert.equal(reviews.get(id), null);
});
