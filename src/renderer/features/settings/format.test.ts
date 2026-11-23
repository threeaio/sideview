import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsd } from "./format.ts";

test("Beträge: Cent unter einem Dollar, sonst Dollar", () => {
  assert.equal(formatUsd(0), "0 ct");
  assert.equal(formatUsd(0.0000004), "< 0,01 ct");
  assert.equal(formatUsd(0.0006), "0,06 ct");
  assert.equal(formatUsd(0.5), "50,00 ct");
  assert.equal(formatUsd(1.234), "1,23 $");
});

test("Beträge englisch", () => {
  assert.equal(formatUsd(0, "en"), "0¢");
  assert.equal(formatUsd(0.0000004, "en"), "< 0.01¢");
  assert.equal(formatUsd(0.0006, "en"), "0.06¢");
  assert.equal(formatUsd(1234.5, "en"), "$1,234.50");
});
