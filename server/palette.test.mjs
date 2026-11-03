import assert from "node:assert/strict";
import { test } from "node:test";
import { readColorResponse } from "./palette.ts";

const message = (text) => ({ type: "message", content: [{ type: "output_text", text }] });
const response = (colors) => ({
  status: "completed",
  output: [message(JSON.stringify({ colors }))],
});

test("accepts 1–9 colors, preserving the model's count and order", () => {
  for (const count of [1, 4, 9]) {
    const colors = Array.from({ length: count }, (_, i) => `#00000${i}`);
    assert.deepEqual(readColorResponse(response(colors.map((hex) => ({ hex, weight: 1 })))), {
      colors,
      weights: Array(count).fill(1 / count),
    });
  }
});

test("preserves repeated colors and normalizes the share of each occurrence", () => {
  const colors = ["#FF0000", "#0000FF", "#FF0000"];
  const weights = [14, 1, 5];
  assert.deepEqual(
    readColorResponse(response(colors.map((hex, i) => ({ hex, weight: weights[i] })))),
    { colors, weights: [0.7, 0.05, 0.25] },
  );
});

test("keeps valid colors if weights are absent or invalid", () => {
  for (const weight of [undefined, 0, -1, "20", 101]) {
    assert.deepEqual(readColorResponse(response([{ hex: "#FF0000", weight }])), {
      colors: ["#FF0000"],
    });
  }
});

test("rejects invalid sizes and malformed colors without silently repairing them", () => {
  for (const colors of [
    [],
    Array(10).fill({ hex: "#FFFFFF", weight: 10 }),
    ["red"],
    [{ hex: "#12345", weight: 100 }],
    [123456],
    "#FFFFFF",
    null,
  ])
    assert.equal(readColorResponse(response(colors)), null);
});

test("rejects incomplete responses, refusals and invalid JSON", () => {
  assert.equal(
    readColorResponse({ ...response([{ hex: "#FFFFFF", weight: 100 }]), status: "incomplete" }),
    null,
  );
  assert.equal(
    readColorResponse({
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    }),
    null,
  );
  for (const text of ['{"colors":', "null", '{"color":"#FFFFFF"}'])
    assert.equal(readColorResponse({ status: "completed", output: [message(text)] }), null);
});
