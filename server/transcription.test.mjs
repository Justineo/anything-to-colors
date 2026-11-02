import assert from "node:assert/strict";
import { test } from "node:test";
import { readAudio, readTranscript, transcriptionForm } from "./transcription.ts";
import { maxAudioBytes, maxTextLength } from "../shared/limits.ts";

test("audio is validated, bounded and sent with a matching extension and fixed model", async () => {
  for (const [type, extension] of [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/mp4", "mp4"],
  ]) {
    const audio = await readAudio(
      new Request("https://local/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": type },
        body: "audio bytes",
      }),
    );
    const form = transcriptionForm(audio, type);
    assert.equal(form.get("model"), "gpt-transcribe");
    assert.equal(form.get("file").name, `voice.${extension}`);
    assert.equal(await form.get("file").text(), "audio bytes");
  }
});

test("invalid, empty and oversized uploads are rejected before inference", async () => {
  for (const [type, body] of [
    ["text/plain", "abc"],
    ["constructor", "abc"],
    ["__proto__", "abc"],
    ["audio/webm", ""],
    ["audio/mp4", new Uint8Array(maxAudioBytes + 1)],
  ])
    await assert.rejects(
      readAudio(
        new Request("https://local", {
          method: "POST",
          headers: { "Content-Type": type },
          body,
        }),
      ),
    );
});

test("streamed audio preserves binary bytes across chunk boundaries", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 255, 1]));
      controller.enqueue(new Uint8Array([128, 2]));
      controller.close();
    },
  });
  const audio = await readAudio(
    new Request("https://local", {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body,
      duplex: "half",
    }),
  );
  assert.deepEqual([...audio], [0, 255, 1, 128, 2]);
});

test("transcripts must fit the existing color input without truncating speech", () => {
  assert.equal(readTranscript({ text: "  雨后黄昏  " }), "雨后黄昏");
  assert.equal(readTranscript({ text: "字".repeat(maxTextLength) }), "字".repeat(maxTextLength));
  assert.equal(
    readTranscript({ text: "字".repeat(maxTextLength - 1) + "。" }),
    "字".repeat(maxTextLength - 1),
  );
  assert.equal(readTranscript({ text: "字".repeat(maxTextLength) + "。" }), null);
  for (const value of [
    null,
    {},
    { text: 42 },
    { text: " " },
    { text: "字".repeat(maxTextLength + 1) },
  ])
    assert.equal(readTranscript(value), null);
});

test("a lone trailing period is removed in every supported language", () => {
  for (const text of [
    "雨后的森林。",
    "雨上がりの森。",
    "비 온 뒤의 숲.",
    "A quiet forest.",
    "Une forêt paisible.",
    "Ein stiller Wald.",
    "Un bosque tranquilo.",
    "Uma floresta tranquila.",
    "雨后的森林．",
    "雨后的森林.",
    "A quiet forest。",
  ])
    assert.equal(readTranscript({ text: `  ${text}  ` }), text.slice(0, -1), text);
  assert.equal(readTranscript({ text: "夏天，海边 。" }), "夏天，海边");
  assert.equal(readTranscript({ text: "Bleu, vert et or." }), "Bleu, vert et or");
});

test("sentence boundaries, expressive punctuation and quoted text are preserved", () => {
  for (const text of [
    "天亮了。出发吧。",
    "朝だ。出発しよう。",
    "비가 왔다. 숲으로 가자.",
    "It rained. A quiet forest.",
    "Il pleut. Une forêt paisible.",
    "Es regnet. Ein stiller Wald.",
    "Llueve. Un bosque tranquilo.",
    "Chove. Uma floresta tranquila.",
    "雨后的森林！",
    "雨后的森林？",
    "雨后的森林……",
    "A quiet forest...",
    "A quiet forest….",
    "A quiet forest..",
    "海边！森林。",
    "海边？森林。",
    "¿Un bosque? Verde.",
    "¡Verde! Un bosque.",
    "「雨后的森林。」",
    '"A quiet forest."',
    ...["\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"].map(
      (separator) => `Blue${separator}green.`,
    ),
    "没有句号",
    "No period",
    ".",
    "。",
    "．",
    ",.",
  ])
    assert.equal(readTranscript({ text }), text, text);
});

test("numeric endings, addresses and common abbreviations are preserved across locales", () => {
  for (const text of [
    "3.14",
    "3.14.",
    "蓝色 3.5 米。",
    "Der 3.",
    "第三版 ３．",
    "https://example.com.",
    "https://localhost.",
    "FTP://localhost。",
    "a@example.com.",
    "user@localhost.",
    "U.S.",
    "z.B.",
    "p.ex.",
    "p.ej.",
    "p.ex。",
    "Blue, etc.",
    "Le titre de Mme.",
    "Le titre de M.",
    "Der Titel von Prof.",
    "Blau usw.",
    "El título de Dra.",
    "Ver pág.",
    "O título de Srta.",
    "Dr.",
    "DR.",
    "Dr．",
  ])
    assert.equal(readTranscript({ text }), text, text);
  assert.equal(readTranscript({ text: "Palmeira." }), "Palmeira");
  assert.equal(readTranscript({ text: "Forest." }), "Forest");
  assert.equal(readTranscript({ text: "陈医生。" }), "陈医生");
});
