import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { localRelay, relayHeaders } from "./local-relay.mjs";

const directory = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + sep) : undefined;
let delay = 40;
let calls = 0;
const runtime = await localRelay(async () => {
  calls++;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return new Response('{"ok":true}');
}, directory);
try {
  const session = await runtime.dispatchFetch("http://relay/api/session", {
    method: "POST",
    headers: relayHeaders,
  });
  if (!session.ok) throw new Error("Session registration failed");
  const samples = [];
  for (delay of [40, 40, 40, 180, 180, 180]) {
    const began = performance.now();
    const response = await runtime.dispatchFetch("http://relay/api/color", {
      method: "POST",
      headers: relayHeaders,
      body: '{"input":"rain"}',
    });
    await response.text();
    if (!response.ok) throw new Error(`Relay failed: ${response.status}`);
    const total = performance.now() - began;
    const upstream = Number(/luna;dur=(\d+)/.exec(response.headers.get("Server-Timing"))[1]);
    samples.push({
      upstreamMs: upstream,
      totalMs: Math.round(total),
      overheadMs: Math.round(total - upstream),
    });
  }
  const overhead = samples.map((sample) => sample.overheadMs).sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        environment: "local workerd; simulated inference; no paid model requests",
        upstreamCalls: calls,
        medianOverheadMs: (overhead[2] + overhead[3]) / 2,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.dispose();
}
