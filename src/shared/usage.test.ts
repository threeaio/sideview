import { test } from "node:test";
import assert from "node:assert/strict";
import { jevCallsFromLog, summarizeUsage } from "./usage.ts";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test("Heute, Mittel je Tag seit dem ersten Aufruf, laufender Monat", () => {
  const now = new Date(2026, 10, 5, 18);
  const calls = [
    { at: at(2026, 10, 30), inputTokens: 1_000_000 }, // Oktober: nicht im Monat
    { at: at(2026, 11, 4), inputTokens: 500_000 },
    { at: at(2026, 11, 5, 9), inputTokens: 250_000 },
    { at: at(2026, 11, 5, 17), inputTokens: 250_000 },
  ];
  const u = summarizeUsage(calls, now, 1);
  assert.equal(u.today, 0.5);
  assert.equal(u.month, 1);
  // 30.10. bis 5.11. sind 7 Tage, zusammen 2 Mio. Token
  assert.ok(Math.abs(u.perDay - 2 / 7) < 1e-12);
  assert.equal(u.calls, 4);
});

test("Ohne Aufrufe alles null", () => {
  assert.deepEqual(summarizeUsage([], new Date(2026, 10, 5), 1), { today: 0, perDay: 0, month: 0, calls: 0, since: null, usdPerMtok: 1 });
});

test("Nur Zeilen mit Jev-Aufruf zählen", () => {
  const log = [
    JSON.stringify({ at: "2026-11-05T10:00:00.000Z", event: "utterance", jev: { inputTokens: 900 } }),
    JSON.stringify({ at: "2026-11-05T10:01:00.000Z", event: "utterance", jev: null }),
    '{"at":"2026-11-05T10:02:00.000Z","jev":{"inputTokens":',
    "",
  ].join("\n");
  assert.deepEqual(jevCallsFromLog(log), [{ at: "2026-11-05T10:00:00.000Z", inputTokens: 900 }]);
});
