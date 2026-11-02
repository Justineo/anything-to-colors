import assert from "node:assert/strict";
import { test } from "node:test";
import { holdRecorder, outsideRecordingArea } from "./voice.ts";
import { maxAudioBytes, maxRecordingMs } from "../shared/limits.ts";

function setup(capture) {
  const states = [],
    errors = [],
    sent = [];
  let stopped = 0;
  let limits = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const recorder = {
    state: "inactive",
    mimeType: "audio/webm",
    onstop: null,
    ondataavailable: null,
    start() {
      this.state = "recording";
    },
    stop() {
      this.state = "inactive";
    },
  };
  const voice = holdRecorder(
    {
      state: (state) => states.push(state),
      error: (error) => errors.push(error),
      limit: () => limits++,
      audio: async (blob) => {
        sent.push(await blob.text());
      },
    },
    {
      capture: capture ?? (async () => stream),
      recorder: () => recorder,
    },
  );
  const data = (blob = new Blob(["spoken words"])) => recorder.ondataavailable({ data: blob });
  return {
    voice,
    recorder,
    states,
    errors,
    sent,
    stream,
    data,
    stopped: () => stopped,
    limits: () => limits,
  };
}

test("buffer allows 80px of drift beyond every edge; crossing cancels", () => {
  const origin = { x: 228, y: 228 };
  for (const [x, y] of [
    [120, 120],
    [336, 336],
    [180, 240],
    [240, 330],
  ])
    assert.equal(outsideRecordingArea(x, y, origin), false);
  for (const [x, y] of [
    [119, 200],
    [337, 200],
    [200, 119],
    [200, 337],
  ])
    assert.equal(outsideRecordingArea(x, y, origin), true);
});

test("release stops the microphone immediately and sends final chunks exactly once", async () => {
  const s = setup();
  await s.voice.start();
  s.voice.release();
  s.voice.release();
  assert.equal(s.stopped(), 1);
  s.data();
  await s.recorder.onstop();
  assert.deepEqual(s.sent, ["spoken words"]);
  assert.deepEqual(s.states, ["permission", "recording", "sending", "idle"]);
});

test("the recording deadline cancels and discards final chunks without uploading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  await s.voice.start();
  t.mock.timers.tick(maxRecordingMs - 1);
  assert.equal(s.recorder.state, "recording");
  assert.equal(s.stopped(), 0);
  t.mock.timers.tick(1);
  assert.equal(s.recorder.state, "inactive");
  assert.equal(s.stopped(), 1);
  assert.equal(s.states.at(-1), "idle");
  s.voice.release();
  s.data();
  await s.recorder.onstop();
  t.mock.timers.tick(maxRecordingMs);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.states, ["permission", "recording", "idle"]);
  assert.equal(s.limits(), 1);
  assert.deepEqual(s.errors, []);
});

test("a late deadline cannot cancel audio already released for processing", async (t) => {
  let deadline;
  t.mock.method(globalThis, "setTimeout", (callback) => {
    deadline = callback;
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const s = setup();
  await s.voice.start();
  s.voice.release();
  s.data();
  const processing = s.recorder.onstop();
  deadline();
  await processing;
  assert.deepEqual(s.sent, ["spoken words"]);
  assert.equal(s.limits(), 0);
  assert.deepEqual(s.errors, []);
});

test("an oversized final chunk is cancelled even after the user releases", async () => {
  const s = setup();
  await s.voice.start();
  s.voice.release();
  s.data(new Blob([new Uint8Array(maxAudioBytes + 1)]));
  await s.recorder.onstop();
  assert.deepEqual(s.sent, []);
  assert.equal(s.limits(), 1);
  assert.deepEqual(s.errors, []);
});

test("permission waiting does not consume recording time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const capture = Promise.withResolvers();
  const s = setup(() => capture.promise);
  const starting = s.voice.start();
  t.mock.timers.tick(maxRecordingMs * 2);
  assert.equal(s.states.at(-1), "permission");
  capture.resolve(s.stream);
  await starting;
  t.mock.timers.tick(maxRecordingMs - 1);
  assert.equal(s.recorder.state, "recording");
  t.mock.timers.tick(1);
  assert.equal(s.states.at(-1), "idle");
  s.data();
  await s.recorder.onstop();
  assert.deepEqual(s.sent, []);
  assert.equal(s.limits(), 1);
});

test("a timed out session cannot upload stale audio into a new recording", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  await s.voice.start();
  s.data(new Blob(["expired"]));
  const expiredStop = s.recorder.onstop;
  t.mock.timers.tick(maxRecordingMs);
  await s.voice.start();
  await expiredStop();
  s.data(new Blob(["fresh"]));
  s.voice.release();
  await s.recorder.onstop();
  assert.deepEqual(s.sent, ["fresh"]);
  assert.equal(s.limits(), 1);
  assert.deepEqual(s.errors, []);
});

test("cancelled and released recordings cannot stop a subsequent recording", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  await s.voice.start();
  t.mock.timers.tick(maxRecordingMs / 2);
  s.voice.cancel();
  await s.voice.start();
  t.mock.timers.tick(maxRecordingMs / 2);
  assert.equal(s.recorder.state, "recording");
  s.voice.release();
  s.data();
  await s.recorder.onstop();
  await s.voice.start();
  t.mock.timers.tick(maxRecordingMs / 2);
  assert.equal(s.recorder.state, "recording");
  s.voice.cancel();
  assert.deepEqual(s.sent, ["spoken words"]);
  assert.deepEqual(s.errors, []);
});

test("cancelling discards queued data and stop callbacks without sending", async () => {
  const s = setup();
  await s.voice.start();
  s.data();
  s.voice.cancel();
  s.data();
  await s.recorder.onstop();
  s.voice.release();
  assert.deepEqual(s.sent, []);
  assert.ok(s.stopped() > 0);
  assert.equal(s.states.at(-1), "idle");
});

test("release before permission resolves stops a late stream without starting capture", async () => {
  let resolve;
  const s = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = s.voice.start();
  s.voice.release();
  resolve(s.stream);
  await pending;
  assert.equal(s.recorder.state, "inactive");
  assert.equal(s.stopped(), 1);
  assert.deepEqual(s.sent, []);
});

test("a cancelled recording can be followed by a new recording without sending old audio", async () => {
  const s = setup();
  await s.voice.start();
  s.data(new Blob(["discarded"]));
  const cancelledStop = s.recorder.onstop;
  s.voice.cancel();
  await cancelledStop();
  await s.voice.start();
  s.data(new Blob(["new recording"]));
  s.voice.release();
  await s.recorder.onstop();
  assert.deepEqual(s.sent, ["new recording"]);
  assert.deepEqual(s.states, [
    "permission",
    "recording",
    "idle",
    "permission",
    "recording",
    "sending",
    "idle",
  ]);
  assert.deepEqual(s.errors, []);
});

test("a stale permission result cannot interfere with a newer recording", async () => {
  const pending = [];
  const s = setup(() => new Promise((done) => pending.push(done)));
  const first = s.voice.start();
  s.voice.cancel();
  const second = s.voice.start();
  pending[0](s.stream);
  await first;
  assert.equal(s.states.at(-1), "permission");
  pending[1](s.stream);
  await second;
  assert.equal(s.states.at(-1), "recording");
  s.voice.cancel();
});

test("denied permission passes silently; oversized audio is not sent", async () => {
  const denied = setup(async () => {
    throw new DOMException("Denied", "NotAllowedError");
  });
  await denied.voice.start();
  assert.deepEqual(denied.errors, []);
  assert.equal(denied.states.at(-1), "idle");
  const s = setup();
  await s.voice.start();
  s.data(new Blob([new Uint8Array(maxAudioBytes + 1)]));
  await s.recorder.onstop();
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.errors, []);
  assert.equal(s.limits(), 1);
});
