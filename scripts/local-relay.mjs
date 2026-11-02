import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Use the workerd shipped with the project's deployment tool; no cloud account or model calls.
export async function localRelay(infer, directory = new URL("../backend/", import.meta.url)) {
  const require = createRequire(
    realpathSync(new URL("../node_modules/void/package.json", import.meta.url)),
  );
  const wrangler = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = await import(wrangler.resolve("miniflare"));
  const config = JSON.parse(await readFile(new URL("wrangler.json", directory), "utf8"));
  return new Miniflare(
    convertV4MiniflareOptions({
      modulesRoot: fileURLToPath(directory),
      modules: [config.main, "rate-limit.mjs"].map((file) => ({
        type: "ESModule",
        path: fileURLToPath(new URL(file, directory)),
      })),
      compatibilityDate: config.compatibility_date,
      bindings: { ...config.vars, OPENAI_API_KEY: "test-key", COLOR_RELAY_TOKEN: "test-relay" },
      durableObjects: Object.fromEntries(
        config.durable_objects.bindings.map((binding) => [
          binding.name,
          { className: binding.class_name, useSQLite: true },
        ]),
      ),
      outboundService: infer,
    }),
  );
}

export const relayHeaders = {
  Authorization: "Bearer test-relay",
  "X-Color-Client": "e9310d6d-0718-49d1-a2b7-56f598c4f0a3",
  "X-Color-IP": "a".repeat(64),
};
