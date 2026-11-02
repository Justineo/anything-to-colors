import {
  initializeLocale,
  resolveLocale,
  locale,
  messagesForLocale,
  presetCaptions,
} from "./locale";
import { configureTypography, warmFonts } from "./fonts";

// Fetch the selected words and the app in parallel, before rendering either language.
async function start() {
  const language = new URLSearchParams(location.search).get("lang");
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  // Start the selected font CSS and tiny invitation font beside the locale data.
  configureTypography(resolveLocale(languages, language), "");
  const [, { mount }] = await Promise.all([
    initializeLocale(languages, language).then(() => {
      configureTypography(locale, messagesForLocale.invite + presetCaptions.join(""));
      void warmFonts(messagesForLocale.invite);
    }),
    import("./mount"),
  ]);
  document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
  const title = `Anything to colors — ${messagesForLocale.invite}`;
  document.title = title;
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", title);
  }
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ]) {
    document
      .querySelector<HTMLMetaElement>(selector)
      ?.setAttribute("content", messagesForLocale.description);
  }
  const socialLocales = {
    zh: "zh_CN",
    en: "en_US",
    ja: "ja_JP",
    ko: "ko_KR",
    fr: "fr_FR",
    de: "de_DE",
    es: "es_ES",
    pt: "pt_PT",
  };
  document
    .querySelector<HTMLMetaElement>('meta[property="og:locale"]')
    ?.setAttribute("content", socialLocales[locale]);
  mount();
}

// Trackpad pinch uses Ctrl+wheel; Safari also exposes a native gesture event.
window.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.preventDefault();
  },
  { passive: false },
);
window.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key))
    event.preventDefault();
});

void start();
