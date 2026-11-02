import assert from "node:assert/strict";
import { test } from "node:test";
import { fit, graphemes } from "./typography.ts";

const block = (measure) => ({
  style: { fontSize: "" },
  get offsetHeight() {
    return measure(parseFloat(this.style.fontSize));
  },
});

test("fitting follows the rendered height, including an extra wrapped line", () => {
  const element = block((size) => (size > 32 ? 10 : 6) * size * 1.4);
  const size = fit(element, 390, 844);
  assert.ok(size <= 32 && size >= 18);
  assert.ok(element.offsetHeight <= 422);
  assert.equal(parseFloat(element.style.fontSize), size);
});

test("shortening a draft restores its full size, and viewport changes refit it", () => {
  let lines = 10;
  const element = block((size) => lines * size * 1.4);
  assert.ok(fit(element, 390, 844) < 39);
  lines = 1;
  assert.equal(fit(element, 390, 844), 39);
  assert.equal(fit(element, 1440, 900), 84);
  assert.equal(fit(element, 180, 844), 20);
});

test("unavoidable overflow keeps a readable minimum and terminates", () => {
  const element = block((size) => 500 * size * 1.4);
  assert.equal(fit(element, 390, 844), 18);
});

test("wrapping preserves emoji graphemes and explicit line breaks", () => {
  assert.deepEqual(graphemes("雨👨‍👩‍👧‍👦🇨🇳👍🏽\nA\u0301"), ["雨", "👨‍👩‍👧‍👦", "🇨🇳", "👍🏽", "\n", "A\u0301"]);
});
