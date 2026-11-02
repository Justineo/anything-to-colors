import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// Stub only the platform base class; the relay and job logic run unchanged.
const source = (await readFile(new URL("worker.mjs", import.meta.url), "utf8"))
  .replace(
    'import { DurableObject } from "cloudflare:workers";',
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
  )
  .replace('"./rate-limit.mjs"', JSON.stringify(new URL("rate-limit.mjs", import.meta.url).href));
const { default: relay, ColorJob } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const identity = {
  "X-Color-Client": "e9310d6d-0718-49d1-a2b7-56f598c4f0a3",
  "X-Color-IP": "a".repeat(64),
};
const env = {
  OPENAI_API_KEY: "test-key",
  COLOR_RELAY_TOKEN: "test-relay",
  RATE_LIMITS: {
    idFromName: (id) => id,
    get: () => ({
      admit: async () => ({ status: 200, lease: "test-lease" }),
      release: async () => {},
    }),
  },
};
const payload = JSON.stringify({
  input: "blue",
  model: "gpt-6-luna",
  reasoning: { effort: "none" },
});
function createJob() {
  const entries = new Map();
  const storage = {
    alarmAt: null,
    async get(key) {
      return structuredClone(entries.get(key));
    },
    async put(key, value) {
      entries.set(key, structuredClone(value));
    },
    async deleteAll() {
      entries.clear();
    },
    async setAlarm(time) {
      this.alarmAt = time;
    },
    async deleteAlarm() {
      this.alarmAt = null;
    },
  };
  return { job: new ColorJob({ storage }, env), storage, entries };
}
afterEach(() => mock.restoreAll());

test("one result wait is notified by the alarm and consumes persisted output once", async () => {
  const { job, entries, storage } = createJob();
  const fetch = mock.method(globalThis, "fetch", async () =>
    Response.json({ colors: ["#123456"] }),
  );
  await job.start(payload);
  const result = job.wait(1_000);
  await job.alarm();
  assert.equal((await result).status, 200);
  assert.equal(await job.take(), undefined);
  assert.equal(entries.size, 0);
  assert.equal(storage.alarmAt, null);
  assert.equal(fetch.mock.callCount(), 1);
});

test("a completion between the first storage read and awaiting notification cannot be lost", async () => {
  const { job, storage } = createJob();
  mock.method(globalThis, "fetch", async () => new Response("ready"));
  await job.start(payload);
  const get = storage.get.bind(storage);
  let finish = true;
  storage.get = async (key) => {
    const value = await get(key);
    if (finish) {
      finish = false;
      await job.alarm();
    }
    return value;
  };
  assert.equal((await job.wait(1_000)).body, "ready");
});

test("an interrupted wait times out without starting inference", async () => {
  const { job } = createJob();
  const fetch = mock.method(globalThis, "fetch", () => assert.fail("Only alarms may infer"));
  await job.start(payload);
  assert.equal(await job.wait(1), undefined);
  assert.equal(fetch.mock.callCount(), 0);
});

test("an empty result wait releases the admission lease and never retries a job", async () => {
  const released = [];
  let runs = 0;
  const response = await relay.fetch(
    new Request("https://relay/api/color", {
      method: "POST",
      headers: { ...identity, Authorization: "Bearer test-relay" },
      body: payload,
    }),
    {
      ...env,
      RATE_LIMITS: {
        idFromName: (id) => id,
        get: () => ({
          admit: async () => ({ status: 200, lease: "waiting" }),
          release: async (lease) => released.push(lease),
        }),
      },
      COLOR_JOBS: {
        idFromName: (id) => id,
        get: () => ({
          run: async () => {
            runs++;
          },
        }),
      },
    },
  );
  assert.equal(response.status, 504);
  assert.equal(runs, 1);
  assert.deepEqual(released, ["waiting"]);
});

test("unauthorized and oversized requests cannot schedule inference", async () => {
  const protectedEnv = {
    ...env,
    COLOR_JOBS: {
      get() {
        throw new Error("Must not create a job");
      },
    },
  };
  const unauthorized = await relay.fetch(
    new Request("https://relay/api/color", { method: "POST", body: payload }),
    protectedEnv,
  );
  assert.equal(unauthorized.status, 401);
  const oversized = await relay.fetch(
    new Request("https://relay/api/color", {
      method: "POST",
      body: "色".repeat(11_000),
      headers: { ...identity, Authorization: "Bearer test-relay" },
    }),
    protectedEnv,
  );
  assert.equal(oversized.status, 413);
});

test("HTTP handler passes only payload to a separate job and preserves upstream status", async () => {
  const calls = [];
  const job = {
    async run(body, audioType) {
      assert.equal(audioType, undefined);
      calls.push(body);
      return { status: 429, body: '{"error":"busy"}', ms: 12 };
    },
  };
  const response = await relay.fetch(
    new Request("https://relay/api/color", {
      method: "POST",
      body: payload,
      headers: {
        ...identity,
        Authorization: "Bearer test-relay",
        "CF-IPCountry": "CN",
        "X-Forwarded-For": "192.0.2.1",
      },
    }),
    { ...env, COLOR_JOBS: { idFromName: (id) => id, get: () => job } },
  );
  assert.deepEqual(calls, [payload]);
  assert.equal(response.status, 429);
  assert.match(
    response.headers.get("Server-Timing"),
    /^luna;dur=12, admission;dur=\d+, relay;dur=\d+$/,
  );
});

test("only alarm calls Luna; replay does not charge twice or erase an unread result", async () => {
  const { job, storage, entries } = createJob();
  const fetch = mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal((await storage.get("job")).body, undefined);
    assert.equal(init.body, payload);
    assert.deepEqual(init.headers, {
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    return new Response('{"answers":{}}');
  });
  await job.start(payload);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(await job.take(), undefined);
  await job.alarm();
  await job.alarm();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await job.take()).body, '{"answers":{}}');
  assert.equal(entries.size, 0);
  assert.equal(storage.alarmAt, null);
});

test("failed inference returns a bounded error without retrying the paid request", async () => {
  const { job } = createJob();
  const fetch = mock.method(globalThis, "fetch", async () => {
    throw new Error("Network failure");
  });
  await job.start(payload);
  await job.alarm();
  await job.alarm();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await job.take()).status, 504);
});

test("expired or interrupted jobs are reclaimed without invoking Luna", async () => {
  const { job, storage, entries } = createJob();
  const fetch = mock.method(globalThis, "fetch", () => {
    throw new Error("Must not call Luna");
  });
  await storage.put("job", { body: payload, expiresAt: Date.now() - 1 });
  await job.alarm();
  assert.equal(entries.size, 0);
  await storage.put("job", { expiresAt: Date.now() + 60_000 });
  await job.alarm();
  assert.ok(storage.alarmAt > Date.now());
  assert.equal(fetch.mock.callCount(), 0);
});

test("audio inference uses the fixed transcription endpoint and removes stored audio before sending", async () => {
  const { job, storage } = createJob();
  const audio = new TextEncoder().encode("recorded audio").buffer;
  const fetch = mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal((await storage.get("job")).body, undefined);
    assert.deepEqual(init.headers, { Authorization: "Bearer test-key" });
    assert.equal(init.body.get("model"), "gpt-transcribe");
    assert.equal(init.body.get("file").name, "voice.mp4");
    assert.equal(await init.body.get("file").text(), "recorded audio");
    return Response.json({ text: "Dusk after rain" });
  });
  await job.start(audio, "audio/mp4");
  await job.alarm();
  await job.alarm();
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(JSON.parse((await job.take()).body), { text: "Dusk after rain" });
});

test("audio relay rejects unauthenticated, invalid and oversized uploads before scheduling", async () => {
  const protectedEnv = {
    ...env,
    COLOR_JOBS: {
      get() {
        throw new Error("Must not create job");
      },
    },
  };
  for (const [type, body, token, status] of [
    ["audio/mp4", "audio", "", 401],
    ["text/plain", "audio", "test-relay", 415],
    ["constructor", "audio", "test-relay", 415],
    ["__proto__", "audio", "test-relay", 415],
    ["audio/webm", new Uint8Array(1_048_577), "test-relay", 413],
    ["audio/webm", "", "test-relay", 413],
  ]) {
    const response = await relay.fetch(
      new Request("https://relay/api/transcribe", {
        method: "POST",
        headers: { ...identity, "Content-Type": type, Authorization: `Bearer ${token}` },
        body,
      }),
      protectedEnv,
    );
    assert.equal(response.status, status);
  }
});

test("audio relay keeps the binary upload and content type across the job boundary", async () => {
  const calls = [];
  const response = await relay.fetch(
    new Request("https://relay/api/transcribe", {
      method: "POST",
      headers: {
        ...identity,
        "Content-Type": "audio/webm;codecs=opus",
        Authorization: "Bearer test-relay",
      },
      body: "voice bytes",
    }),
    {
      ...env,
      COLOR_JOBS: {
        idFromName: (id) => id,
        get: () => ({
          run: async (...args) => {
            calls.push(args);
            return { status: 200, body: '{"text":"Morning light"}', ms: 20 };
          },
        }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(calls[0][0]), "voice bytes");
  assert.equal(calls[0][1], "audio/webm;codecs=opus");
});

test("shared admission rejects both endpoints before a job can be created", async () => {
  for (const path of ["/api/color", "/api/transcribe"]) {
    const response = await relay.fetch(
      new Request(`https://relay${path}`, {
        method: "POST",
        body: path.endsWith("color") ? payload : "audio",
        headers: { ...identity, Authorization: "Bearer test-relay", "Content-Type": "audio/mp4" },
      }),
      {
        ...env,
        RATE_LIMITS: {
          idFromName: (id) => id,
          get: () => ({
            admit: async () => ({ status: 429, code: "rate_limited", retryAfter: 17 }),
          }),
        },
        COLOR_JOBS: { get: () => assert.fail("Rejected requests must not create jobs") },
      },
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "17");
    assert.equal((await response.json()).code, "rate_limited");
  }
});

test("missing browser identity is refused even with a valid relay credential", async () => {
  const response = await relay.fetch(
    new Request("https://relay/api/color", {
      method: "POST",
      body: payload,
      headers: { Authorization: "Bearer test-relay" },
    }),
    env,
  );
  assert.equal(response.status, 401);
});

test("concurrency is released even when creating the inference job fails", async () => {
  const released = [];
  await assert.rejects(
    relay.fetch(
      new Request("https://relay/api/color", {
        method: "POST",
        body: payload,
        headers: { ...identity, Authorization: "Bearer test-relay" },
      }),
      {
        ...env,
        RATE_LIMITS: {
          idFromName: (id) => id,
          get: () => ({
            admit: async () => ({ status: 200, lease: "reserved" }),
            release: async (lease) => released.push(lease),
          }),
        },
        COLOR_JOBS: {
          idFromName: (id) => id,
          get: () => {
            throw new Error("Job unavailable");
          },
        },
      },
    ),
    /Job unavailable/,
  );
  assert.deepEqual(released, ["reserved"]);
});

test("session registration trusts verification only through the authenticated relay request", async () => {
  const registrations = [];
  const response = await relay.fetch(
    new Request("https://relay/api/session", {
      method: "POST",
      headers: { ...identity, Authorization: "Bearer test-relay", "X-Color-Verified": "1" },
    }),
    {
      ...env,
      RATE_LIMITS: {
        idFromName: (id) => id,
        get: () => ({
          register: async (...args) => {
            registrations.push(args);
            return { status: 200 };
          },
        }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(registrations, [[identity["X-Color-Client"], identity["X-Color-IP"], true]]);
});
