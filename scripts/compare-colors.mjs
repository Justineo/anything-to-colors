import { mkdir, readFile, writeFile } from "node:fs/promises";
import { channels, rgbToHex } from "../server/color.ts";
import {
  imageryVariants,
  palette,
  positions,
  questionsFor,
  variants as literalVariants,
} from "./color-prompts.mjs";

const imagery = process.argv.includes("--imagery");
const variants = imagery ? imageryVariants : literalVariants;

for (const name of ["JEV_API_KEY", "OPENAI_API_KEY"])
  if (!process.env[name]) throw new Error(`Missing ${name}`);

const cases = imagery
  ? [
      "The same sea in the mist of early morning",
      "The same sea at moonless midnight",
      "Summer noon, sunlight through linen curtains",
      "Winter dusk, faint light through linen curtains",
      "A handwritten letter just received from a lover",
      "Finding a letter from a lover in an old book years later",
      "Sunlight through a slice of fresh lemon",
      "A faded lemon tree in an old photograph",
      "A brightly lit jazz bar",
      "A jazz bar just closed on a rainy night",
      "A damp forest after spring rain",
      "A dry, quiet forest in late autumn",
    ].map((text) => ({ text }))
  : [
      { text: "red", expected: "#FF0000" },
      { text: "blue", expected: "#0000FF" },
      { text: "lime", expected: "#00FF00" },
      { text: "white", expected: "#FFFFFF" },
      { text: "rebeccapurple", expected: "#663399" },
      { text: "tomato", expected: "#FF6347" },
      { text: "#A1B2C3", expected: "#A1B2C3" },
      { text: "#09F", expected: "#0099FF" },
      { text: "rgb(12, 34, 56)", expected: "#0C2238" },
      { text: "the color red", expected: "#FF0000" },
      { text: "pure blue", expected: "#0000FF" },
      { text: "#7c3b9e", expected: "#7C3B9E" },
      { text: "a ripe lemon" },
      { text: "a ripe banana" },
      { text: "a clear midday sky" },
      { text: "fresh green grass" },
      { text: "the deep sea" },
      { text: "a quiet rainy night" },
    ];

const file = new URL(
  `../benchmarks/${imagery ? "imagery" : "prompt"}-comparison.json`,
  import.meta.url,
);
await mkdir(new URL("../benchmarks/", import.meta.url), { recursive: true });
const results = process.argv.includes("--resume")
  ? JSON.parse(await readFile(file, "utf8")).results
  : [];
const jobs = cases.flatMap((item) =>
  variants.flatMap((variant) =>
    ["jev", "luna"].map((provider) => ({ ...item, variant, provider })),
  ),
);
const pending = jobs.filter(
  (job) =>
    !results.some(
      (result) =>
        result.provider === job.provider &&
        result.variant === job.variant &&
        result.text === job.text,
    ),
);
let save = Promise.resolve();
async function run(job) {
  const questions = questionsFor(job.variant);
  const jev = job.provider === "jev";
  const body = jev
    ? {
        model: "jev-1.14.0",
        state: job.text,
        questions: Object.fromEntries(
          questions.map(({ name, choices, ...question }) => [
            name,
            {
              ...question,
              criteria: Object.fromEntries(
                choices.map(({ value, description }) => [value, description]),
              ),
            },
          ]),
        ),
      }
    : { model: "gpt-6-luna", input: job.text, questions };
  const start = performance.now();
  let result;
  try {
    const response = await fetch(
      jev ? "https://api.typesafe.ai/v1/systemone" : "https://api.openai.com/v1/decisions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jev ? process.env.JEV_API_KEY : process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = await response.json().catch(() => ({}));
    const choice = (name) =>
      jev
        ? data.answers?.[name]?.choice
        : data.answers?.find((answer) => answer.name === name)?.choice;
    // Keep malformed answer lists on the original comparison's failure path.
    const values = positions.map(choice);
    const selected = choice("color");
    const rgb = channels.map(choice);
    let color = null;
    if (job.variant.startsWith("rgb")) color = rgbToHex(rgb);
    else if (job.variant === "palette") color = palette[selected] ?? null;
    else if (values.every((value) => typeof value === "string" && /^[0-9A-F]$/.test(value)))
      color = "#" + values.join("");
    result = {
      ...job,
      status: response.status,
      color,
      model: data.model ?? body.model,
      exact: job.expected ? color === job.expected : null,
      error: data.error?.code ?? data.error?.type ?? null,
      usage: data.usage ?? null,
    };
  } catch (error) {
    result = {
      ...job,
      status: null,
      color: null,
      exact: job.expected ? false : null,
      error: error.name,
    };
  }
  result.ms = Math.round(performance.now() - start);
  results.push(result);
  console.log(
    JSON.stringify({
      done: results.length,
      ...job,
      color: result.color,
      status: result.status,
      ms: result.ms,
    }),
  );
  save = save.then(() =>
    writeFile(
      file,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          evaluation: imagery
            ? "Atmospheric interpretation across six paired scenes; no reference colors, fixed palette, or exact-match score. Diversity is descriptive, not a quality score."
            : "Literal CSS/hex reproduction; not a measure of creative interpretation.",
          transport: "Local Node.js requests. Latency includes network and concurrency effects.",
          prompts: Object.fromEntries(variants.map((variant) => [variant, questionsFor(variant)])),
          results,
        },
        null,
        2,
      ) + "\n",
    ),
  );
  await save;
}
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (pending.length) await run(pending.shift());
  }),
);
for (const provider of ["jev", "luna"])
  for (const variant of variants) {
    const group = results.filter(
      (result) => result.provider === provider && result.variant === variant,
    );
    const exact = group.filter((result) => result.expected);
    const times = group
      .filter((result) => result.status === 200)
      .map((result) => result.ms)
      .sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        provider,
        variant,
        ...(exact.length
          ? { exact: `${exact.filter((result) => result.exact).length}/${exact.length}` }
          : {}),
        uniqueColors: new Set(group.map((result) => result.color).filter(Boolean)).size,
        valid: `${group.filter((result) => result.color).length}/${group.length}`,
        medianMs: times[Math.floor(times.length / 2)],
      }),
    );
  }
