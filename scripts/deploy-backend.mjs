import { readFile } from "node:fs/promises";
import { cloudflareApi } from "./cloudflare-api.mjs";

const config = JSON.parse(
  await readFile(new URL("../backend/wrangler.json", import.meta.url), "utf8"),
);
const api = await cloudflareApi();
const path = `/workers/scripts/${config.name}`;
const worker = (await api("/workers/scripts")).find((worker) => worker.id === config.name);
const settings = worker ? await api(path + "/settings") : { bindings: [] };
const metadata = {
  main_module: config.main,
  compatibility_date: config.compatibility_date,
  bindings: [
    ...config.durable_objects.bindings.map((binding) => ({
      type: "durable_object_namespace",
      ...binding,
    })),
    ...Object.entries(config.vars ?? {}).map(([name, text]) => ({
      type: "plain_text",
      name,
      text,
    })),
    ...["OPENAI_API_KEY", "COLOR_RELAY_TOKEN"].map((name) => {
      if (!process.env[name]) throw new Error("Missing " + name);
      return { type: "secret_text", name, text: process.env[name] };
    }),
  ],
};
const newClasses = config.durable_objects.bindings
  .filter((binding) => !settings.bindings.some((existing) => existing.name === binding.name))
  .map((binding) => binding.class_name);
if (newClasses.length)
  metadata.migrations = {
    old_tag: worker?.migration_tag ?? "",
    new_tag: config.migrations.at(-1).tag,
    new_sqlite_classes: newClasses,
  };
const body = new FormData();
body.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
for (const module of [config.main, "rate-limit.mjs"])
  body.set(
    module,
    new Blob([await readFile(new URL("../backend/" + module, import.meta.url))], {
      type: "application/javascript+module",
    }),
    module,
  );
await api(path, { method: "PUT", body });
await api(path + "/subdomain", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true, previews_enabled: false }),
});
console.log(
  "Deployed color relay: https://anything-to-color-luna.justice360.workers.dev/api/color",
);
