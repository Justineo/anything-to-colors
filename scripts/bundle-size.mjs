import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const root = new URL("../dist/client/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", root), "utf8"));
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
assert.ok(entry, "Build the client before measuring its bundle");

function dependencies(key, found = new Set()) {
  if (found.has(key)) return found;
  found.add(key);
  for (const dependency of manifest[key].imports ?? []) dependencies(dependency, found);
  return found;
}

async function size(keys) {
  const files = [...new Set([...keys].map((key) => manifest[key].file))];
  let raw = 0,
    gzip = 0;
  for (const file of files) {
    const source = await readFile(new URL(file, root));
    raw += source.length;
    gzip += gzipSync(source).length;
  }
  return {
    "JS kB": (raw / 1000).toFixed(2),
    "gzip kB": (gzip / 1000).toFixed(2),
    requests: files.length,
  };
}

const common = dependencies(entry);
dependencies("src/mount.ts", common);
assert.ok(![...common].some((key) => key.includes("/locales/") || key.includes("verification")));
const html = await readFile(new URL("index.html", root), "utf8");
const preloads = [...html.matchAll(/<link\b[^>]*>/g)]
  .filter(([tag]) => tag.includes('rel="modulepreload"'))
  .map(([tag]) => /href="([^"]+)"/.exec(tag)?.[1]);
assert.ok(
  preloads.includes(`/${manifest["src/mount.ts"].file}`),
  "Discover the app from HTML, before bootstrap JS runs",
);
const rows = {};
for (const key of Object.keys(manifest).filter((key) => key.startsWith("src/locales/"))) {
  assert.ok(manifest[key].isDynamicEntry, `${key} must remain lazy-loaded`);
  assert.ok(!preloads.includes(`/${manifest[key].file}`), "Do not preload unselected languages");
  const selected = dependencies(key, new Set(common));
  assert.equal([...selected].filter((key) => key.startsWith("src/locales/")).length, 1);
  const language = manifest[key].name;
  const css = manifest[`src/fonts/${language}-ui.css`];
  const fontBytes = css ? gzipSync(await readFile(new URL(css.file, root))).length : 0;
  rows[language] = { ...(await size(selected)), "font CSS gzip kB": (fontBytes / 1000).toFixed(2) };
}
console.log("Initial JavaScript, including the app and exactly one language (gzip per file):");
console.table(rows);
