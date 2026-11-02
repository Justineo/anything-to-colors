import { mkdir, readFile, writeFile } from "node:fs/promises";

const region = process.argv[2];
if (!region) throw new Error("Usage: node scripts/benchmark-region.mjs <region>");
const samples = [];
for (const text of [
  "The sky",
  "A forest after rain",
  "The seaside at dusk",
  "Pure white",
  "Late at night",
  "Strawberries",
  "Warm sunshine",
  "Mint",
]) {
  const start = performance.now();
  try {
    const response = await fetch("https://colors.void.app/api/color", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.json();
    samples.push({
      text,
      status: response.status,
      ok: response.ok && /^#[0-9A-F]{6}$/.test(body.color),
      ms: Math.round(performance.now() - start),
      timing: response.headers.get("server-timing"),
      placement: response.headers.get("x-jev-placement"),
      ingress: response.headers.get("cf-ray")?.split("-").at(-1),
      ...body,
    });
  } catch (error) {
    samples.push({
      text,
      ok: false,
      ms: Math.round(performance.now() - start),
      error: error.message,
    });
  }
  console.log(JSON.stringify(samples.at(-1)));
  if (samples.length >= 3 && samples.every((sample) => !sample.ok)) break;
}
const times = samples
  .slice(1)
  .filter((sample) => sample.ok)
  .map((sample) => sample.ms)
  .sort((a, b) => a - b);
const result = {
  region,
  measuredAt: new Date().toISOString(),
  successes: samples.filter((sample) => sample.ok).length,
  total: samples.length,
  medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
  p90Ms: times.length ? times[Math.ceil(times.length * 0.9) - 1] : null,
  samples,
};
const file = new URL("../benchmarks/regions.json", import.meta.url);
await mkdir(new URL("../benchmarks/", import.meta.url), { recursive: true });
const results = JSON.parse(await readFile(file, "utf8").catch(() => "[]"));
results.push(result);
await writeFile(file, JSON.stringify(results, null, 2) + "\n");
console.log(
  JSON.stringify({
    region,
    successes: result.successes,
    total: result.total,
    medianMs: result.medianMs,
    p90Ms: result.p90Ms,
  }),
);
