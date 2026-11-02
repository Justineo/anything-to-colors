import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fontSubsets, excludeGlyphs } from "./font-subsets.ts";

// Generated fonts are checked in: ordinary builds need neither network nor a
// font tool. FontTools preserves variable axes and all surviving layout features.
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = join(tmpdir(), "anything-to-color-font-cache");
const sourceCommit = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec";
const sourceHashes = {
  SC: "eab063faf229160a52d3760f5555150e4eb9e5bf",
  JP: "bd98d809e02880e32f20f1f2a91ef97854f52f57",
  KR: "cc85b383766708c9291f72baeeab05760774f492",
};
await mkdir(cache, { recursive: true });

async function download(url) {
  const path = join(cache, createHash("sha256").update(url).digest("hex"));
  try {
    return await readFile(path);
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert.ok(response.ok, `${response.status}: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(path, data);
  return data;
}

async function splitFont(source, output, subsets, preserveBounds = false) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const plan = join(output, "plan.json");
  await writeFile(plan, JSON.stringify({ source, output, subsets, preserveBounds }));
  const { stdout } = await execute(process.env.FONTTOOLS_PYTHON ?? "python3", [
    join(root, "scripts/subset-font.py"),
    plan,
  ]);
  return JSON.parse(stdout);
}

const report = {};
for (const [language, region] of Object.entries({ zh: "SC", ja: "JP", ko: "KR" })) {
  const copy = JSON.parse(await readFile(join(root, `src/locales/${language}.json`), "utf8"));
  const subsets = fontSubsets(copy.invite, copy.presets);
  const sourceUrl = `https://raw.githubusercontent.com/google/fonts/${sourceCommit}/ofl/notoserif${region.toLowerCase()}/NotoSerif${region}%5Bwght%5D.ttf`;
  const cssUrl = `https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-serif-${region.toLowerCase()}@5.3.1/wght.css`;
  const [source, upstream] = await Promise.all([download(sourceUrl), download(cssUrl)]);
  const hash = createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex");
  assert.equal(hash, sourceHashes[region], `${language}: pinned source font`);
  const family = `Noto Serif ${region} Variable`;
  const output = join(cache, `split-${language}`);
  const sourcePath = join(cache, `${region}.ttf`);
  await writeFile(sourcePath, source);
  const faces = await splitFont(sourcePath, output, subsets);
  const assets = join(root, `src/assets/fonts/${language}`);
  await mkdir(assets, { recursive: true });
  const keep = new Set();
  const uiFaces = [];
  const groups = [];
  for (const [index, { file, points }] of faces.entries()) {
    const data = await readFile(file);
    const name =
      index === 0
        ? `${language}-hint.woff2`
        : `${language}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.woff2`;
    keep.add(name);
    await writeFile(join(assets, name), data);
    const ranges = points.map((point) => `U+${point.toString(16)}`).join(",");
    uiFaces.push(
      `@font-face{font-family:"${family}";src:url(../assets/fonts/${language}/${name}) format("woff2");font-style:normal;font-display:swap;font-weight:200 900;unicode-range:${ranges};}`,
    );
    groups.push({ ranges: points.map((point) => [point, point]), bytes: data.length });
  }

  const excluded = new Set();
  for (const { points } of faces) for (const point of points) excluded.add(point);
  const fullFaces = [...upstream.toString().matchAll(/@font-face\s*\{[^}]+\}/g)].flatMap(
    ([face]) => {
      const range = /unicode-range:\s*([^;]+);/.exec(face);
      const ranges = excludeGlyphs(range[1], excluded);
      if (!ranges) return [];
      const src = /url\(([^)]+)\)/.exec(face)[1].replace(/["']/g, "");
      return [
        {
          face: face.replace(range[0], `unicode-range: ${ranges};`),
          url: new URL(src, cssUrl).href,
        },
      ];
    },
  );
  // Bound parallel downloads; ordinary builds never download fonts.
  const fullCss = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < fullFaces.length) {
        const index = cursor++;
        const { face, url } = fullFaces[index];
        const name = basename(new URL(url).pathname);
        const data = await download(url);
        keep.add(name);
        await writeFile(join(assets, name), data);
        fullCss[index] = face.replace(/url\([^)]+\)/, `url(../assets/fonts/${language}/${name})`);
      }
    }),
  );
  for (const file of await readdir(assets)) if (!keep.has(file)) await rm(join(assets, file));
  const header = `/* Generated by scripts/prepare-fonts.mjs; Noto Serif ${region}, OFL: /fonts/LICENSE-Noto-Serif-${region}.txt */\n`;
  await writeFile(join(root, `src/fonts/${language}-ui.css`), header + uiFaces.join("\n"));
  await writeFile(join(root, `src/fonts/${language}.css`), header + fullCss.join("\n"));
  const samples = copy.presets.map((caption) => {
    const points = [...(copy.invite + caption)].map((char) => char.codePointAt(0));
    const selected = groups.filter(({ ranges }) =>
      points.some((point) => ranges.some(([a, b]) => point >= a && point <= b)),
    );
    return {
      bytes: selected.reduce((sum, group) => sum + group.bytes, 0),
      requests: selected.length,
    };
  });
  const sorted = samples.map(({ bytes }) => bytes).sort((a, b) => a - b);
  report[language] = {
    source: sourceUrl,
    sourceGitBlob: hash,
    hintBytes: groups[0].bytes,
    groups: groups.length,
    firstCaption: samples[0],
    medianBytes: sorted[Math.floor(sorted.length / 2)],
    maxBytes: sorted.at(-1),
  };
  console.log(language, report[language]);
}
// Only baseline metrics and HEX labels need Latin on CJK startup. Keep visible
// prose in the original font, including its kerning and ligatures.
const [metrics] = await splitFont(
  join(root, "src/assets/geist-serif.woff2"),
  join(cache, "split-geist"),
  [Array.from(" Hg#0123456789ABCDEF\u200b", (char) => char.codePointAt(0))],
  true,
);
const metricFont = await readFile(metrics.file);
await writeFile(join(root, "src/assets/geist-ui.woff2"), metricFont);
report.latinUi = { bytes: metricFont.length, glyphs: " Hg#0123456789ABCDEF\u200b" };
await mkdir(join(root, "benchmarks"), { recursive: true });
await writeFile(join(root, "benchmarks/font-subsets.json"), JSON.stringify(report, null, 2) + "\n");
