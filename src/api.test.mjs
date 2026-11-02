import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createApi } from "./api.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("typing can prepare a session once without invoking verification or a model", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return Response.json(url === "/api/session" ? { ready: true } : {});
  });
  const api = createApi(
    () => assert.fail("Preparation must not open verification"),
    () => {},
  );
  await Promise.all([api.prepare(), api.prepare()]);
  assert.deepEqual(calls, ["/api/session"]);
  await api("/api/color", { method: "POST" });
  assert.deepEqual(calls, ["/api/session", "/api/color"]);
});

test("a prepared challenge waits for submission and is shared by concurrent callers", async () => {
  let verified = 0;
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    if (url !== "/api/session") return Response.json({});
    return init.headers["X-Turnstile-Token"]
      ? Response.json({ ready: true })
      : Response.json({ code: "verification_required", sitekey: "key" }, { status: 403 });
  });
  const api = createApi(
    async () => {
      verified++;
      return "token";
    },
    () => {},
  );
  await api.prepare();
  assert.equal(verified, 0);
  await Promise.all([
    api("/api/color", { method: "POST" }),
    api("/api/transcribe", { method: "POST" }),
  ]);
  assert.equal(verified, 1);
  assert.deepEqual(calls, ["/api/session", "/api/session", "/api/color", "/api/transcribe"]);
});

test("failed preparation is silent and a later submission can establish a new session", async () => {
  let sessions = 0;
  mock.method(globalThis, "fetch", async (url) => {
    if (url === "/api/session" && ++sessions === 1) throw new Error("Offline");
    return Response.json(url === "/api/session" ? { ready: true } : {});
  });
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  await api.prepare();
  assert.equal((await api("/api/color", { method: "POST" })).status, 200);
  assert.equal(sessions, 2);
});

test("cancelling one session waiter cannot cancel another or invoke its model", async () => {
  const ready = Promise.withResolvers();
  const paths = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    paths.push(url);
    if (url === "/api/session") {
      await ready.promise;
      assert.equal(init.signal.aborted, false);
      return Response.json({ ready: true });
    }
    return Response.json({});
  });
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  const controller = new AbortController();
  const cancelled = api("/api/color", { method: "POST", signal: controller.signal });
  const other = api("/api/transcribe", { method: "POST" });
  controller.abort();
  ready.resolve();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal((await other).status, 200);
  assert.deepEqual(paths, ["/api/session", "/api/transcribe"]);
});

test("a refused session is invalidated for the next request without retrying inference", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return url === "/api/session"
      ? Response.json({ ready: true })
      : new Response(null, { status: 401 });
  });
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  for (let i = 0; i < 2; i++)
    assert.equal((await api("/api/color", { method: "POST" })).status, 401);
  assert.deepEqual(calls, ["/api/session", "/api/color", "/api/session", "/api/color"]);
});

test("concurrent requests establish one session and both endpoints use it", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url, new Headers(init.headers)]);
    return Response.json(url === "/api/session" ? { ready: true } : {});
  });
  const api = createApi(
    () => assert.fail("Unexpected verification"),
    () => {},
  );
  await Promise.all([
    api("/api/color", { method: "POST" }),
    api("/api/transcribe", { method: "POST" }),
  ]);
  assert.deepEqual(
    calls.map(([url]) => url),
    ["/api/session", "/api/color", "/api/transcribe"],
  );
  assert.ok(calls.every(([, headers]) => headers.get("X-Color-Request") === "1"));
});

test("verification retries only session establishment, never the paid API", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    if (url !== "/api/session") return new Response("Unavailable", { status: 502 });
    if (init.headers["X-Turnstile-Token"] === "verified-token")
      return Response.json({ ready: true });
    return Response.json({ code: "verification_required", sitekey: "public-key" }, { status: 403 });
  });
  const api = createApi(
    async (sitekey) => {
      assert.equal(sitekey, "public-key");
      assert.deepEqual(calls, ["/api/session"]);
      return "verified-token";
    },
    () => {},
  );
  assert.equal((await api("/api/color", { method: "POST" })).status, 502);
  assert.deepEqual(calls, ["/api/session", "/api/session", "/api/color"]);
});

test("cancelled verification cannot invoke a model and can be attempted later", async () => {
  const fetch = mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api/session");
    return Response.json({ code: "verification_required", sitekey: "key" }, { status: 403 });
  });
  const api = createApi(
    async () => {
      throw new Error("Cancelled");
    },
    () => {},
  );
  for (let i = 0; i < 2; i++)
    await assert.rejects(api("/api/color", { method: "POST" }), /Cancelled/);
  assert.equal(fetch.mock.callCount(), 2);
});

test("429 preserves the response and starts a shared cooldown without retrying", async () => {
  const waits = [];
  const fetch = mock.method(globalThis, "fetch", async (url) =>
    url === "/api/session"
      ? Response.json({ ready: true })
      : Response.json({ error: "Slow down" }, { status: 429, headers: { "Retry-After": "42" } }),
  );
  const api = createApi(
    () => assert.fail(),
    (seconds) => waits.push(seconds),
  );
  const response = await api("/api/transcribe", { method: "POST" });
  assert.deepEqual(waits, [42]);
  assert.deepEqual(await response.json(), { error: "Slow down" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("requests work without AbortSignal.timeout or AbortSignal.any", async () => {
  for (const name of ["timeout", "any"])
    mock.method(AbortSignal, name, () => assert.fail(`${name} requires a newer browser`));
  mock.method(globalThis, "fetch", async (url) =>
    Response.json(url === "/api/session" ? { ready: true } : { colors: ["#123456"] }),
  );
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  assert.deepEqual(await (await api("/api/color", {})).json(), { colors: ["#123456"] });
});

test("an already cancelled submission does not establish a session", async () => {
  const fetch = mock.method(globalThis, "fetch", () => assert.fail());
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api("/api/color", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("cancelling an in-flight request preserves the caller's abort reason", async () => {
  const started = Promise.withResolvers();
  mock.method(globalThis, "fetch", (url, { signal }) => {
    if (url === "/api/session") return Promise.resolve(Response.json({ ready: true }));
    started.resolve();
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
  });
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  const controller = new AbortController();
  const pending = api("/api/transcribe", { signal: controller.signal });
  await started.promise;
  const reason = new Error("Cancelled by the caller");
  controller.abort(reason);
  await assert.rejects(pending, (cause) => cause === reason);
});

test("a session deadline rejects and allows a later attempt", async () => {
  const fetch = mock.method(
    globalThis,
    "fetch",
    (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  const pending = api("/api/color", {});
  mock.timers.tick(12_000);
  await assert.rejects(pending, { name: "TimeoutError" });
  fetch.mock.restore();
  mock.method(globalThis, "fetch", async (url) =>
    Response.json(url === "/api/session" ? { ready: true } : {}),
  );
  assert.equal((await api("/api/color", {})).status, 200);
});

test("endpoint deadlines still abort slow response bodies after headers arrive", async () => {
  let requestSignal;
  mock.method(globalThis, "fetch", async (url, { signal }) => {
    if (url === "/api/session") return Response.json({ ready: true });
    requestSignal = signal;
    return new Response(
      new ReadableStream({
        start(stream) {
          signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
        },
      }),
    );
  });
  const api = createApi(
    () => assert.fail(),
    () => {},
  );
  for (const [path, timeout] of [
    ["/api/color", 20_000],
    ["/api/transcribe", 28_000],
  ]) {
    const controller = new AbortController();
    const response = await api(path, { signal: controller.signal });
    const body = response.json();
    mock.timers.tick(timeout - 1);
    assert.equal(requestSignal.aborted, false);
    mock.timers.tick(1);
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(body, { name: "TimeoutError" });
    assert.equal(controller.signal.aborted, false);
  }
});
