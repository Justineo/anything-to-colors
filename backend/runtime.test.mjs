import assert from "node:assert/strict";
import { test } from "node:test";
import { localRelay, relayHeaders } from "../scripts/local-relay.mjs";

test("real workerd runs the alarm concurrently with its waiting RPC for color and audio", async (t) => {
  const calls = [];
  const runtime = await localRelay(async (request) => {
    calls.push(request.url);
    assert.equal(request.headers.get("X-Color-Client"), null);
    assert.equal(request.headers.get("X-Color-IP"), null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response('{"ok":true}');
  });
  t.after(() => runtime.dispose());
  assert.equal(
    (
      await runtime.dispatchFetch("http://relay/api/session", {
        method: "POST",
        headers: relayHeaders,
      })
    ).status,
    200,
  );
  const results = await Promise.all(
    ["color", "transcribe"].map((path) =>
      runtime.dispatchFetch(`http://relay/api/${path}`, {
        method: "POST",
        headers: {
          ...relayHeaders,
          "Content-Type": path === "color" ? "application/json" : "audio/webm",
        },
        body: path === "color" ? '{"input":"rain"}' : "mock audio",
      }),
    ),
  );
  for (const response of results) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.match(response.headers.get("Server-Timing"), /admission;dur=\d+, relay;dur=\d+/);
  }
  assert.deepEqual(calls.sort(), [
    "https://api.openai.com/v1/audio/transcriptions",
    "https://api.openai.com/v1/responses",
  ]);
});
