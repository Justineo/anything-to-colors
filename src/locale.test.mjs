import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initializeLocale,
  loadLocale,
  messagesForLocale,
  presetCaptions,
  resolveLocale,
} from "./locale.ts";
import { presets } from "./presets.ts";

test("Chinese and English regional preferences use their supported base language", () => {
  for (const language of ["zh", "zh-CN", "zh-TW", "zh-Hant-HK", "ZH_cn"])
    assert.equal(resolveLocale([language]), "zh");
  for (const language of ["en", "en-US", "en-GB", "EN_au"])
    assert.equal(resolveLocale([language]), "en");
  for (const language of ["ja-JP", "ko-KR", "fr-CA", "de-AT", "es-MX", "pt-BR"])
    assert.equal(resolveLocale([language]), language.slice(0, 2));
});

test("the first supported browser language wins", () => {
  assert.equal(resolveLocale(["en-US", "zh-CN"]), "en");
  assert.equal(resolveLocale(["zh-CN", "en-US"]), "zh");
  assert.equal(resolveLocale(["it-IT", "fr-FR", "zh-CN", "en-US"]), "fr");
});

test("missing or unsupported preferences fall back to English", () => {
  assert.equal(resolveLocale([]), "en");
  assert.equal(resolveLocale(["it-IT", "ru-RU"]), "en");
  assert.equal(resolveLocale(["", "english", "zho"]), "en");
});

test("a supported URL language overrides browser preferences, including regional tags", () => {
  for (const code of ["zh", "en", "ja", "ko", "fr", "de", "es", "pt"])
    assert.equal(resolveLocale(["en-US", "zh-CN"], code), code);
  assert.equal(resolveLocale(["zh-CN"], " en-GB "), "en");
  assert.equal(resolveLocale(["en-US"], "ZH_hant_TW"), "zh");
  assert.equal(resolveLocale(["zh-CN"], "pt-BR"), "pt");
});

test("an absent, empty or unsupported URL language preserves browser detection", () => {
  for (const override of [undefined, null, "", " ", "it-IT", "english", "__proto__"])
    assert.equal(resolveLocale(["ja-JP", "en-US"], override), "ja");
  assert.equal(resolveLocale([], "unsupported"), "en");
});

test("a forced language loads its own copy even when the browser prefers another language", async () => {
  const { locale, data } = await loadLocale(["zh-CN"], "fr-CA");
  assert.equal(locale, "fr");
  assert.equal(data.generate, "Créer une palette");
});

test("every language has complete UI copy and a caption for each shared palette", async () => {
  const english = (await loadLocale(["en"])).data;
  for (const code of ["zh", "en", "ja", "ko", "fr", "de", "es", "pt"]) {
    const { locale, data } = await loadLocale([code]);
    assert.equal(locale, code);
    assert.deepEqual(Object.keys(data).sort(), Object.keys(english).sort());
    assert.equal(data.presets.length, presets.length);
    for (const caption of data.presets) assert.ok(caption.trim());
    for (const [key, value] of Object.entries(data)) {
      if (key === "presets") continue;
      assert.ok(value.trim());
      assert.deepEqual(value.match(/\{\w+\}/g)?.sort(), english[key].match(/\{\w+\}/g)?.sort());
    }
  }
});

test("formatted status uses localized singular/plural and preserves literal user text", async () => {
  await initializeLocale(["en-GB"]);
  assert.equal(messagesForLocale.palette("Sea", 1), "Sea, 1 color");
  assert.equal(messagesForLocale.palette("Sea", 3), "Sea, 3 colors");
  assert.equal(messagesForLocale.palette("{count}", 2), "{count}, 2 colors");
  assert.equal(messagesForLocale.copy("#FFFFFF"), "Copy #FFFFFF");
  assert.equal(presetCaptions[0], "Celadon after the rain");
  await initializeLocale(["en-US"], "ja-JP");
  assert.equal(messagesForLocale.palette("海", 3), "海、3色");
});
