import assert from "node:assert/strict";
import { test } from "node:test";
import { readColors } from "./luna.ts";

const message = (text) => ({ type: "message", content: [{ type: "output_text", text }] });
const response = (colors) => ({
  status: "completed",
  output: [message(JSON.stringify({ colors }))],
});

test("accepts 1–9 colors, preserving the model's count and order", () => {
  for (const count of [1, 4, 9]) {
    const colors = Array.from({ length: count }, (_, i) => `#00000${i}`);
    assert.deepEqual(readColors(response(colors)), colors);
  }
});

test("preserves repeated colors in an intentional sequence", () => {
  const colors = ["#FF0000", "#0000FF", "#FF0000"];
  assert.deepEqual(readColors(response(colors)), colors);
});

test("rejects invalid sizes and malformed colors without silently repairing them", () => {
  for (const colors of [
    [],
    Array(10).fill("#FFFFFF"),
    ["red"],
    ["#12345"],
    [123456],
    "#FFFFFF",
    null,
  ])
    assert.equal(readColors(response(colors)), null);
});

test("rejects incomplete responses, refusals and invalid JSON", () => {
  assert.equal(readColors({ ...response(["#FFFFFF"]), status: "incomplete" }), null);
  assert.equal(
    readColors({
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    }),
    null,
  );
  for (const text of ['{"colors":', "null", '{"color":"#FFFFFF"}'])
    assert.equal(readColors({ status: "completed", output: [message(text)] }), null);
});
