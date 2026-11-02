import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compactGlsl, compactShaderModule } from "../scripts/compact-shaders.ts";
import * as shaders from "./shaders.ts";

const tokens = (source) => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").match(/\w+|[^\s]/g);

test("production GLSL retains every token and the version directive newline", () => {
  for (const [name, source] of Object.entries(shaders)) {
    if (typeof source !== "string") continue;
    const compact = compactGlsl(source);
    assert.deepEqual(tokens(compact), tokens(source), name);
    assert.ok(compact.startsWith("#version 300 es\n"), name);
    assert.ok(!compact.includes("//"), name);
  }
});

test("directives in a shared snippet still start their own line once interpolated", async () => {
  const source = await readFile(new URL("./shaders.ts", import.meta.url), "utf8");
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(compactShaderModule(source)).toString("base64")}`
  );
  for (const [name, glsl] of Object.entries(built)) {
    if (typeof glsl !== "string") continue;
    for (const line of glsl.split("\n"))
      if (line.includes("#")) assert.ok(line.trimStart().startsWith("#"), `${name}: ${line}`);
  }
});

test("module compaction preserves interpolated sharing and all exported programs", async () => {
  const source = await readFile(new URL("./shaders.ts", import.meta.url), "utf8");
  const compact = compactShaderModule(source);
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(compact).toString("base64")}`
  );
  assert.deepEqual(Object.keys(built), Object.keys(shaders));
  for (const name of Object.keys(shaders)) {
    if (typeof shaders[name] === "string")
      assert.deepEqual(tokens(built[name]), tokens(shaders[name]), name);
    else assert.equal(built[name], shaders[name], name);
  }
  assert.deepEqual(compact.match(/\$\{\w+\}/g), source.match(/\$\{\w+\}/g));
});
