import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fontSubsets, excludeGlyphs } from "../scripts/font-subsets.ts";
import { configureTypography, onFontsReady, warmFonts } from "./fonts.ts";

function fontDocument(t, load) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { fonts: { load } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  configureTypography("en", "");
}

test("font readiness redraws after loading even without FontFaceSet events, and coalesces shared faces", async (t) => {
  const loaded = Promise.withResolvers();
  const face = {};
  const requests = [];
  fontDocument(t, (font, text) => {
    requests.push({ font, text });
    return loaded.promise;
  });
  let redraws = 0;
  t.after(onFontsReady(() => redraws++));
  const first = warmFonts("Hello");
  const second = warmFonts("World");
  assert.equal(redraws, 0);
  loaded.resolve([face]);
  await Promise.all([first, second]);
  assert.equal(redraws, 1);
  assert.deepEqual(
    requests.map((r) => r.text),
    ["HelloHg", "WorldHg"],
  );
  assert.ok(requests.every((r) => r.font.includes("Geist Serif Latin")));
});

test("cached faces do not trigger repeated rasterization but newly loaded faces do", async (t) => {
  const latin = {},
    additional = {};
  let faces = [latin];
  fontDocument(t, async () => faces);
  let redraws = 0;
  t.after(onFontsReady(() => redraws++));
  await warmFonts("A");
  await warmFonts("AB");
  assert.equal(redraws, 1);
  faces = [latin, additional];
  await warmFonts("ABC");
  assert.equal(redraws, 2);
});

test("unsubscribing during a pending font load prevents late redraws", async (t) => {
  const loaded = Promise.withResolvers();
  fontDocument(t, () => loaded.promise);
  let redraws = 0;
  const stop = onFontsReady(() => redraws++);
  t.after(stop);
  const pending = warmFonts("Later");
  stop();
  loaded.resolve([{}]);
  await pending;
  assert.equal(redraws, 0);
});

test("font failures retain the system fallback without reporting a ready face", async (t) => {
  fontDocument(t, async () => {
    throw new Error("Font unavailable");
  });
  let redraws = 0;
  t.after(onFontsReady(() => redraws++));
  await warmFonts("Offline");
  assert.equal(redraws, 0);
});

const declarations = (css) =>
  [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((match) =>
    match[1].split(",").map((range) => {
      const [start, end = start] = range.trim().slice(2).split("-");
      return [parseInt(start, 16), parseInt(end, 16)];
    }),
  );
const includes = (ranges, point) => ranges.some(([start, end]) => point >= start && point <= end);

test("font groups prioritize the invitation and cover each built-in glyph exactly once", () => {
  const captions = ["雨后的森林", "森林里的海", "海边的雨"];
  const groups = fontSubsets("任何想象", captions);
  assert.deepEqual(
    groups[0],
    Array.from("任何想象国…", (char) => char.codePointAt(0)),
  );
  const points = groups.flat();
  assert.equal(new Set(points).size, points.length);
  assert.deepEqual(
    new Set(points),
    new Set(Array.from("任何想象国…" + captions.join(""), (char) => char.codePointAt(0))),
  );
  assert.ok(groups.slice(1).every((group) => group.length <= 32));
});

test("fallback ranges lose only optimized glyphs, including range edges and singletons", () => {
  assert.equal(
    excludeGlyphs("U+100-109,U+200,U+300-302", new Set([0x100, 0x105, 0x109, 0x200, 0x999])),
    "U+101-104,U+106-108,U+300-302",
  );
  assert.equal(excludeGlyphs("U+100-102", new Set([0x100, 0x101, 0x102])), "");
});

test("baseline measurements use a tiny dedicated face without splitting visible Latin text", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const faces = [...html.matchAll(/@font-face\s*\{[^}]+\}/g)].map(([face]) => face);
  const cjk = faces.find((face) => /font-family: "Geist Serif";/.test(face));
  const metrics = faces.find((face) => /font-family: "Geist UI";/.test(face));
  for (const point of [0x48, 0x67]) {
    assert.ok(includes(declarations(cjk).flat(), point));
    assert.ok(includes(declarations(metrics).flat(), point));
  }
  assert.ok(cjk.includes("geist-serif.woff2"));
  assert.ok(metrics.includes("geist-ui.woff2"));
  const spaces = faces.filter(
    (face) => /font-family: "Geist Serif";/.test(face) && includes(declarations(face).flat(), 0x20),
  );
  assert.equal(spaces.length, 1);
  assert.ok(spaces[0].includes("geist-ui.woff2"));
  for (const char of " #0123456789ABCDEF\u200b")
    assert.ok(includes(declarations(metrics).flat(), char.codePointAt(0)));
  const western = faces.find((face) => /font-family: "Geist Serif Latin";/.test(face));
  assert.ok(western.includes("geist-serif.woff2"));
  for (const point of [0x48, 0x67]) assert.ok(includes(declarations(western).flat(), point));
  assert.ok((await readFile(new URL("./assets/geist-ui.woff2", import.meta.url))).length < 8192);
});

test("self-hosted UI and fallback fonts have disjoint coverage and keep all built-in CJK text", async () => {
  for (const language of ["zh", "ja", "ko"]) {
    const ui = await readFile(new URL(`./fonts/${language}-ui.css`, import.meta.url), "utf8");
    const full = await readFile(new URL(`./fonts/${language}.css`, import.meta.url), "utf8");
    const copy = JSON.parse(
      await readFile(new URL(`./locales/${language}.json`, import.meta.url), "utf8"),
    );
    const optimized = declarations(ui).flat();
    const fallback = declarations(full).flat();
    const points = new Set(fontSubsets(copy.invite, copy.presets).flat());
    for (const point of points) assert.ok(includes(optimized, point), `${language}: ${point}`);
    for (const [start, end] of optimized) {
      for (let point = start; point <= end; point++) assert.ok(!includes(fallback, point));
    }
    assert.ok(ui.length < full.length / 3, language);
    for (const [name, css] of [
      [`${language}-ui.css`, ui],
      [`${language}.css`, full],
    ]) {
      assert.ok(!/https?:|local\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
      for (const [, src] of css.matchAll(/src:\s*url\(["']?([^"')]+)["']?\)/g)) {
        const file = await readFile(new URL(src, new URL(`./fonts/${name}`, import.meta.url)));
        assert.equal(file.subarray(0, 4).toString(), "wOF2", src);
      }
    }
  }
});
