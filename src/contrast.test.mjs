import assert from "node:assert/strict";
import { test } from "node:test";
import { calcAPCA } from "apca-w3";
import { foreground } from "./contrast.ts";

test("the hex-only APCA path preserves black/white selection across the RGB gamut", () => {
  const check = (color) => {
    const expected =
      Math.abs(calcAPCA("#000000", color)) >= Math.abs(calcAPCA("#ffffff", color))
        ? "#000000"
        : "#ffffff";
    assert.equal(foreground(color), expected, color);
  };
  const hex = (value) => value.toString(16).padStart(2, "0");
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17) check(`#${hex(r)}${hex(g)}${hex(b)}`);
  for (let gray = 0; gray <= 255; gray++) check(`#${hex(gray).repeat(3)}`);
});
