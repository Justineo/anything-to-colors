import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reuse the Cloudflare session established by `void cloudflare login`.
const dependencyRoot = pathToFileURL(
  realpathSync(new URL("../node_modules/void/package.json", import.meta.url)),
);
const { createCfAuth, createCfProfileStore } = await import(
  new URL("../@cloudflare/workers-auth/dist/cf/index.mjs", dependencyRoot)
);
const logger = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
const auth = createCfAuth({
  logger,
  userAgent: "anything-to-color-region-test",
  prompt: async () => {
    throw new Error("Run void cloudflare login first.");
  },
  select: async () => {
    throw new Error("Run void cloudflare login first.");
  },
  isNoDefaultValueProvidedError: () => false,
});
auth.setProfile(
  createCfProfileStore({ logger }).resolve({
    cwd: fileURLToPath(new URL("../backend", import.meta.url)),
  }),
);
const token = auth.readAuthCredentials()?.oauth_token;
if (!token) throw new Error("No Cloudflare session; run void cloudflare login.");
const endpoint =
  "https://api.cloudflare.com/client/v4/accounts/712272db055c8792a75c0e227ba21762/workers/scripts/anything-to-color-jev";
async function request(path, init = {}) {
  const response = await fetch(endpoint + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(JSON.stringify(data.errors));
  return data.result;
}
const target = process.argv[2];
if (target === "enable-url") {
  console.log(
    await request("/subdomain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: true }),
    }),
  );
} else {
  if (target) {
    if (!/^aws:(us-east-1|us-west-2|ap-northeast-1|ap-southeast-1)$/.test(target))
      throw new Error("Unexpected test region.");
    const body = new FormData();
    body.set("settings", JSON.stringify({ placement: { region: target } }));
    await request("/settings", { method: "PATCH", body });
  }
  const result = await request("/settings");
  console.log(
    JSON.stringify({ placement: result.placement, compatibilityDate: result.compatibility_date }),
  );
  const ready = await fetch("https://anything-to-color-jev.justice360.workers.dev/__void/ready", {
    signal: AbortSignal.timeout(20_000),
  });
  console.log(
    JSON.stringify({
      requestedRegion: target,
      ready: ready.status,
      actualPlacement: ready.headers.get("cf-placement"),
    }),
  );
}
