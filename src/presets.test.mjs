import assert from "node:assert/strict";
import { test } from "node:test";
import { presets } from "./presets.ts";

test("each example has an intentional distribution totaling 100%", () => {
  for (const [index, { colors, weights }] of presets.entries()) {
    const label = `Preset ${index + 1}`;
    assert.equal(weights.length, colors.length, label);
    assert.ok(
      weights.every((weight) => weight > 0),
      label,
    );
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9, label);
    assert.ok(new Set(weights).size > 1, label);
  }
});
