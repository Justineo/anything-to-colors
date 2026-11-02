import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { afterEach, mock, test } from "node:test";
import { maxTextLength } from "../shared/limits.ts";

// Replace framework/auth bindings only; exercise the endpoint and transcript reader unchanged.
const source = stripTypeScriptTypes(
  await readFile(new URL("../routes/api/transcribe.ts", import.meta.url), "utf8"),
)
  .replace('import { defineHandler } from "void";', "const defineHandler = (handler) => handler;")
  .replace(
    'import { env } from "void/env";',
    'const env = { COLOR_RELAY_URL: "https://relay/api/color" };',
  )
  .replace(
    'import { clientAccess, admissionResponse } from "../../server/access";',
    "const clientAccess = async () => new Headers(); const admissionResponse = () => null;",
  )
  .replace(
    '"../../server/transcription"',
    JSON.stringify(new URL("transcription.ts", import.meta.url).href),
  )
  .replace('"../../server/timing"', JSON.stringify(new URL("timing.ts", import.meta.url).href))
  .replace(
    '"../../shared/limits.ts"',
    JSON.stringify(new URL("../shared/limits.ts", import.meta.url).href),
  );
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
afterEach(() => mock.restoreAll());

test("the transcript endpoint distinguishes length cancellation from invalid speech", async () => {
  let transcript;
  const requests = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), body: init.body });
    return Response.json(transcript);
  });
  for (const [body, status, expected] of [
    [{ text: "雨后的森林。" }, 200, { text: "雨后的森林" }],
    [{ text: "字".repeat(maxTextLength) }, 200, { text: "字".repeat(maxTextLength) }],
    [{ text: "字".repeat(maxTextLength + 1) }, 422, { code: "text_too_long" }],
    [{ text: " " }, 422, {}],
    [null, 422, {}],
  ]) {
    transcript = body;
    const request = new Request("https://local/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: "mock audio",
    });
    const headers = new Headers();
    const response = await POST({
      req: { raw: request, header: (name) => request.headers.get(name) },
      header: (name, value) => headers.set(name, value),
      json: (body, status = 200) => Response.json(body, { status, headers }),
    });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.deepEqual(
      {
        ...(result.text ? { text: result.text } : {}),
        ...(result.code ? { code: result.code } : {}),
      },
      expected,
    );
  }
  assert.equal(requests.length, 5);
  assert.ok(
    requests.every(
      ({ url, body }) => url === "https://relay/api/transcribe" && body instanceof Uint8Array,
    ),
  );
});
