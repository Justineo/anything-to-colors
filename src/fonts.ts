const cjkFallback = `"Noto Serif SC Variable", "Noto Serif SC", "Noto Serif JP Variable", "Noto Serif KR Variable", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif`;
export let serif = `"Geist Serif", ${cjkFallback}`;

const loaders = {
  zh: () => import("./fonts/zh-ui.css"),
  ja: () => import("./fonts/ja-ui.css"),
  ko: () => import("./fonts/ko-ui.css"),
};
const fullLoaders = {
  zh: () => import("./fonts/zh.css"),
  ja: () => import("./fonts/ja.css"),
  ko: () => import("./fonts/ko.css"),
};
type Cjk = keyof typeof loaders;
let primary: Cjk | undefined;
const loaded = new Map<string, Promise<unknown>>();
const preloaded = new Set<Cjk>();
const hints = {
  zh: new URL("./assets/fonts/zh/zh-hint.woff2", import.meta.url).href,
  ja: new URL("./assets/fonts/ja/ja-hint.woff2", import.meta.url).href,
  ko: new URL("./assets/fonts/ko/ko-hint.woff2", import.meta.url).href,
};
let coverage = new Set<string>();
const ready = new WeakSet<FontFace>();
const listeners = new Set<() => void>();

export function onFontsReady(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function configureTypography(locale: string, text: string) {
  primary = locale === "zh" || locale === "ja" || locale === "ko" ? locale : undefined;
  const region = locale === "ja" ? "JP" : locale === "ko" ? "KR" : "SC";
  const latin = primary ? "Geist Serif" : "Geist Serif Latin";
  serif = `"${latin}", "Noto Serif ${region} Variable", ${cjkFallback}`;
  coverage = new Set(text);
  if (primary && !preloaded.has(primary)) {
    preloaded.add(primary);
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.type = "font/woff2";
    link.href = hints[primary];
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    void stylesheet(primary, false).catch(() => {});
  }
}

function stylesheet(language: Cjk, full: boolean) {
  const key = full ? `${language}:full` : language;
  const cached = loaded.get(key);
  if (cached) return cached;
  const loading = (full ? fullLoaders : loaders)[language]().catch((cause) => {
    loaded.delete(key);
    throw cause;
  });
  loaded.set(key, loading);
  return loading;
}

function needed(text: string) {
  const languages = new Set<Cjk>();
  if (/\p{Script=Han}/u.test(text)) languages.add(primary ?? "zh");
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) languages.add("ja");
  if (/\p{Script=Hangul}/u.test(text)) languages.add("ko");
  const known = Array.from(text).every(
    (char) =>
      coverage.has(char) ||
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char),
  );
  // JP/KR omit some Han glyphs that the SC fallback contains. Keep that coverage
  // for arbitrary input without loading the fallback for built-in captions.
  if (!known && primary && primary !== "zh" && /\p{Script=Han}/u.test(text)) languages.add("zh");
  return [...languages].flatMap((language) => [
    stylesheet(language, false),
    ...(language !== primary || !known ? [stylesheet(language, true)] : []),
  ]);
}

export async function warmFonts(text: string) {
  try {
    await Promise.all(needed(text));
    // Confirm the faces used by both the text and the canvas's baseline metrics.
    // FontFaceSet's loadingdone event is unavailable in some WebKit versions.
    const font = `300 24px ${serif}`;
    const faces = primary
      ? (
          await Promise.all([
            document.fonts.load(font, text + " "),
            document.fonts.load('400 24px "Geist UI"', "Hg"),
          ])
        ).flat()
      : await document.fonts.load(font, text + "Hg");
    let changed = false;
    for (const face of faces) {
      if (ready.has(face)) continue;
      ready.add(face);
      changed = true;
    }
    if (changed) for (const listener of listeners) listener();
  } catch {
    // System serif fonts remain usable when a font or stylesheet is unavailable.
  }
}
