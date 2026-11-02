import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const name = "anything-to-color-privacy-probe-20261029";
const url = `https://${name}.justice360.workers.dev`;
const source = String.raw`export default {
  async fetch(request, env) {
    if (request.headers.get('Authorization') !== 'Bearer ' + env.PROBE_TOKEN)
      return new Response('Unauthorized', {status: 401});
    const mode = new URL(request.url).searchParams.get('mode') || 'fresh';
    const visitorIP = request.headers.get('CF-Connecting-IP');
    const init = (headers) => {
      const options = {headers, redirect: 'manual', signal: AbortSignal.timeout(15000)};
      if (mode === 'empty-cf') options.cf = {};
      if (mode === 'undefined-cf') options.cf = undefined;
      return options;
    };
    const makeRequest = (target, headers) => {
      const outgoing = new Request(target, init(headers));
      if (mode === 'delete' || mode === 'empty-headers') for (const header of [
        'CF-Connecting-IP', 'CF-Connecting-IPv6', 'CF-IPCountry', 'CF-IPCity',
        'CF-Region', 'CF-Region-Code', 'CF-Postal-Code', 'CF-Timezone',
        'CF-IPLatitude', 'CF-IPLongitude', 'CF-Ray', 'CF-Visitor',
        'X-Real-IP', 'X-Forwarded-For', 'Forwarded', 'True-Client-IP'
      ]) {
        if (mode === 'empty-headers') outgoing.headers.set(header, '');
        else outgoing.headers.delete(header);
      }
      return outgoing;
    };
    const traces = await Promise.all(['www.cloudflare.com', 'api.typesafe.ai'].map(async host => {
      try {
        const response = await fetch(makeRequest('https://' + host + '/cdn-cgi/trace', {}));
        const data = Object.fromEntries((await response.text()).trim().split('\n').map(line => {
          const index = line.indexOf('='); return [line.slice(0,index), line.slice(index+1)];
        }));
        return {host, status: response.status, country: data.loc ?? null,
          colo: data.colo ?? null, hasIP: !!data.ip,
          sameAsIncomingIP: data.ip ? data.ip === visitorIP : null,
          ipIsWorkerSentinel: data.ip === '2a06:98c0:3600::103'};
      } catch (error) { return {host, error: error.message}; }
    }));
    const response = await fetch(makeRequest('https://api.typesafe.ai/v1/models', {
      Authorization: 'Bearer ' + env.JEV_API_KEY,
      'Content-Type': 'application/json'
    }));
    await response.arrayBuffer();
    return Response.json({mode, incomingCountry: request.cf?.country,
      incomingIPIsWorkerSentinel: visitorIP === '2a06:98c0:3600::103',
      incomingColo: request.cf?.colo, traces, jevStatus: response.status},
      {headers: {'Cache-Control': 'no-store'}});
  }
};`;

const command = process.argv[2];
if (command === "test") {
  const results = [];
  for (const mode of (process.env.PROBE_MODES || "fresh,delete,empty-cf,undefined-cf").split(",")) {
    const target = process.env.PROBE_VIA_VOID
      ? "https://colors.void.app/api/privacy-probe"
      : url + "/";
    const response = await fetch(`${target}?mode=${mode}`, {
      headers: { Authorization: `Bearer ${process.env.JEV_RELAY_TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    });
    const result = {
      status: response.status,
      placement: response.headers.get("cf-placement"),
      ...(await response.json()),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await mkdir(new URL("../benchmarks/", import.meta.url), { recursive: true });
  await writeFile(
    `benchmarks/privacy-${process.argv[3] || "direct"}.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
} else {
  const root = pathToFileURL(
    realpathSync(new URL("../node_modules/void/package.json", import.meta.url)),
  );
  const { createCfAuth, createCfProfileStore } = await import(
    new URL("../@cloudflare/workers-auth/dist/cf/index.mjs", root)
  );
  const logger = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
  const auth = createCfAuth({
    logger,
    userAgent: "anything-to-color-privacy-test",
    prompt: async () => {
      throw new Error("Login required");
    },
    select: async () => {
      throw new Error("Login required");
    },
    isNoDefaultValueProvidedError: () => false,
  });
  auth.setProfile(
    createCfProfileStore({ logger }).resolve({
      cwd: fileURLToPath(new URL("../backend", import.meta.url)),
    }),
  );
  const token = auth.readAuthCredentials()?.oauth_token;
  if (!token) throw new Error("Cloudflare login required");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/712272db055c8792a75c0e227ba21762/workers/scripts/${name}`;
  async function api(path, init = {}) {
    const response = await fetch(endpoint + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(JSON.stringify(result.errors));
    return result.result;
  }
  if (command === "delete") {
    await api("", { method: "DELETE" });
    console.log("Temporary privacy probe deleted.");
  } else if (command === "deploy") {
    if (!process.env.JEV_API_KEY || !process.env.JEV_RELAY_TOKEN)
      throw new Error("Missing probe secrets");
    const body = new FormData();
    body.set(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "probe.mjs",
            compatibility_date: "2026-10-26",
            compatibility_flags:
              process.argv[3] === "strict" ? ["global_fetch_strictly_public"] : [],
            bindings: [
              { type: "secret_text", name: "JEV_API_KEY", text: process.env.JEV_API_KEY },
              { type: "secret_text", name: "PROBE_TOKEN", text: process.env.JEV_RELAY_TOKEN },
            ],
          }),
        ],
        { type: "application/json" },
      ),
    );
    body.set(
      "probe.mjs",
      new Blob([source], { type: "application/javascript+module" }),
      "probe.mjs",
    );
    await api("", { method: "PUT", body });
    await api("/subdomain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
    console.log("Temporary privacy probe deployed: " + (process.argv[3] || "default"));
  } else throw new Error("Expected deploy, test, or delete");
}
